#!/usr/bin/env node
require('dotenv').config();

const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const OPENSEARCH_NODE = process.env.OPENSEARCH_NODE;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const INDEX_NAME = 'pageseeker_response_opensearch';
const TABLE_NAME = 'pageseeker_response_opensearch';
const DELETE_DAYS = parseInt(process.env.DELETE_DAYS) || 7;

if (!OPENSEARCH_NODE) {
  console.error('❌ Missing OPENSEARCH_NODE environment variable');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  db: { timeout: 120000, searchPath: 'api' }
});

// Initialize OpenSearch client
const signer = AwsSigv4Signer({
  region: process.env.S3_REGION || 'ap-southeast-1',
  service: 'es',
  getCredentials: fromNodeProviderChain(),
});

const osClient = new Client({
  ...signer,
  node: OPENSEARCH_NODE,
  ssl: { rejectUnauthorized: false },
  requestTimeout: 300000,
  maxRetries: 3
});

async function deleteOldRecords() {
  const startTime = new Date();
  console.log(`🗑️  OpenSearch Delete Job Started`);
  console.log(`📅 Deleting records older than ${DELETE_DAYS} days`);
  console.log(`📊 Index: ${INDEX_NAME}`);
  console.log(`🕐 Server time: ${startTime.toISOString()}`);

  try {
    // Check index exists
    const indexExists = (await osClient.indices.exists({ index: INDEX_NAME })).body;
    if (!indexExists) {
      console.log('⚠️  Index does not exist, nothing to delete');
      process.exit(0);
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DELETE_DAYS);
    const cutoffIso = cutoffDate.toISOString();
    console.log(`📅 Cutoff date: ${cutoffIso}`);

    // Count total records before delete
    const totalBefore = (await osClient.count({ index: INDEX_NAME })).body.count;
    console.log(`📊 Total records before delete: ${totalBefore}`);

    // Count records to be deleted
    const countResult = await osClient.count({
      index: INDEX_NAME,
      body: {
        query: {
          range: {
            collected_at: {
              lt: cutoffIso
            }
          }
        }
      }
    });

    const toDelete = countResult.body.count;
    console.log(`🗑️  Records to delete: ${toDelete}`);

    if (toDelete === 0) {
      console.log('✅ No old records in OpenSearch');
    }

    // === Delete from OpenSearch ===
    let osDeleted = 0;
    if (toDelete > 0) {
      console.log('🔄 Deleting from OpenSearch...');
      const deleteResult = await osClient.deleteByQuery({
        index: INDEX_NAME,
        body: {
          query: {
            range: {
              collected_at: {
                lt: cutoffIso
              }
            }
          }
        },
        refresh: true,
        wait_for_completion: true
      });

      osDeleted = deleteResult.body.deleted || 0;
      const failures = deleteResult.body.failures || [];
      console.log(`   ✅ OpenSearch deleted: ${osDeleted} records`);

      if (failures.length > 0) {
        console.log(`   ⚠️  OpenSearch failures: ${failures.length}`);
        failures.forEach(f => console.error('     -', f));
      }
    }

    // Count remaining OpenSearch records
    const totalAfter = (await osClient.count({ index: INDEX_NAME })).body.count;

    // === Delete from Supabase ===
    console.log('');
    console.log('🔄 Deleting from Supabase...');
    console.log(`🔎 Supabase table: api.${TABLE_NAME}`);

    // Count Supabase records to delete
    const { count: sbCountBefore, error: sbCountErr } = await supabase
      .schema('api')
      .from(TABLE_NAME)
      .select('*', { count: 'exact', head: true });

    if (sbCountErr) {
      console.error('   ❌ Supabase count error:', sbCountErr.message);
    } else {
      console.log(`   📊 Supabase total records: ${sbCountBefore}`);
    }

    // Delete old records from Supabase in batches
    let sbDeleted = 0;
    const sbBatchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      // Select IDs of old records
      const { data: oldRows, error: selectErr } = await supabase
        .schema('api')
        .from(TABLE_NAME)
        .select('id')
        .lt('collected_at', cutoffIso)
        .limit(sbBatchSize);

      if (selectErr) {
        console.error('   ❌ Supabase select error:', selectErr.message);
        break;
      }

      if (!oldRows || oldRows.length === 0) {
        hasMore = false;
        break;
      }

      const ids = oldRows.map(r => r.id);
      const { error: delErr } = await supabase
        .schema('api')
        .from(TABLE_NAME)
        .delete()
        .in('id', ids);

      if (delErr) {
        console.error('   ❌ Supabase delete error:', delErr.message);
        break;
      }

      sbDeleted += ids.length;
      console.log(`   📊 Supabase deleted so far: ${sbDeleted}`);
    }

    console.log(`   ✅ Supabase deleted: ${sbDeleted} records`);

    // Final summary
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('✅ Delete Job Completed!');
    console.log(`📊 Results:`);
    console.log(`   🗑️  OpenSearch deleted: ${osDeleted} records`);
    console.log(`   📊 OpenSearch: ${totalBefore} → ${totalAfter}`);
    console.log(`   �️  Supabase deleted: ${sbDeleted} records`);
    console.log(`   📅 Cutoff: ${cutoffIso}`);
    console.log(`   ⏱️  Duration: ${duration}s`);

    process.exit(0);

  } catch (error) {
    console.error('❌ Delete job failed:', error.message);
    process.exit(1);
  }
}

deleteOldRecords();
