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
const SEEKER_SUPABASE_URL = process.env.SEEKER_SUPABASE_URL;
const SEEKER_SUPABASE_KEY = process.env.SEEKER_SUPABASE_KEY;
const INDEX_NAME = 'pageseeker_response_opensearch';
const TABLE_NAME = 'pageseeker_response_opensearch';
const DELETE_DAYS = parseInt(process.env.DELETE_DAYS) || 1;

if (!OPENSEARCH_NODE) {
  console.error('❌ Missing OPENSEARCH_NODE environment variable');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable');
  process.exit(1);
}

if (!SEEKER_SUPABASE_URL || !SEEKER_SUPABASE_KEY) {
  console.error('❌ Missing SEEKER_SUPABASE_URL or SEEKER_SUPABASE_KEY environment variable');
  process.exit(1);
}

// Initialize Supabase client (Pageseeker-service)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  db: { timeout: 120000, searchPath: 'api' }
});

// Initialize SEEKER Supabase client
const seekerSupabase = createClient(SEEKER_SUPABASE_URL, SEEKER_SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { timeout: 120000, searchPath: 'seeker' }
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

// Helper: Format date in ICT timezone
function formatICT(date) {
  const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
  const ictTime = new Date(date.getTime() + THAI_OFFSET_MS);
  return ictTime.toISOString().replace('T', ' ').replace('Z', ' ICT');
}

// Calculate cutoff date based on Thailand timezone (UTC+7)
function getCutoffDateTH(days) {
  const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
  
  // Get current time in Thailand (UTC+7)
  const now = new Date();
  const thaiTime = new Date(now.getTime() + THAI_OFFSET_MS);
  
  // Get start of today in Thai time (00:00 ICT)
  // We use UTC methods on the shifted time to get midnight
  const todayStartThaiMs = Date.UTC(
    thaiTime.getUTCFullYear(),
    thaiTime.getUTCMonth(),
    thaiTime.getUTCDate(),
    0, 0, 0, 0
  );
  
  // Subtract days to get cutoff date (still in Thai timezone context)
  const cutoffThaiMs = todayStartThaiMs - (days * 24 * 60 * 60 * 1000);
  
  // Convert back to UTC by subtracting Thai offset
  const cutoffUTCMs = cutoffThaiMs - THAI_OFFSET_MS;
  
  return new Date(cutoffUTCMs);
}

// Helper: batch delete from Supabase table
async function batchDeleteSupabase(client, schema, tableName, dateColumn, cutoffIso, label) {
  console.log(`\n� Deleting from ${schema}.${tableName} (${dateColumn} < ${cutoffIso})...`);

  const { count: totalBefore, error: countErr } = await client
    .schema(schema)
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.error(`   ❌ ${label} count error:`, countErr.message);
    return 0;
  }
  console.log(`   📊 ${label} total records: ${totalBefore}`);

  let deleted = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: oldRows, error: selectErr } = await client
      .schema(schema)
      .from(tableName)
      .select('id')
      .lt(dateColumn, cutoffIso)
      .limit(batchSize);

    if (selectErr) {
      console.error(`   ❌ ${label} select error:`, selectErr.message);
      break;
    }

    if (!oldRows || oldRows.length === 0) {
      hasMore = false;
      break;
    }

    const ids = oldRows.map(r => r.id);
    const { error: delErr } = await client
      .schema(schema)
      .from(tableName)
      .delete()
      .in('id', ids);

    if (delErr) {
      console.error(`   ❌ ${label} delete error:`, delErr.message);
      break;
    }

    deleted += ids.length;
    console.log(`   📊 ${label} deleted so far: ${deleted}`);
  }

  const { count: totalAfter } = await client
    .schema(schema)
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  console.log(`   ✅ ${label} deleted: ${deleted} records (${totalBefore} → ${totalAfter})`);
  return deleted;
}

// Helper: count risk_level distribution from api.pageseeker_response_opensearch
async function countRiskLevels(cutoffIso, mode) {
  // mode: 'all' = count all records, 'old' = count records < cutoff
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (let level = 1; level <= 5; level++) {
    let query = supabase
      .schema('api')
      .from(TABLE_NAME)
      .select('*', { count: 'exact', head: true })
      .eq('ad_risk_level', level);

    if (mode === 'old') {
      query = query.lt('collected_at', cutoffIso);
    }

    const { count, error } = await query;
    if (error) {
      console.error(`   ❌ Risk level ${level} count error:`, error.message);
    } else {
      counts[level] = count || 0;
    }
  }

  return counts;
}

async function deleteOldRecords() {
  const startTime = new Date();
  const cutoffDate = getCutoffDateTH(DELETE_DAYS);
  const cutoffIso = cutoffDate.toISOString();
  const cutoffDateOnly = cutoffIso.split('T')[0]; // YYYY-MM-DD for date columns

  console.log(`🗑️  OpenSearch Delete Job Started`);
  console.log(`📅 Deleting records older than ${DELETE_DAYS} day(s) (Thailand time)`);
  console.log(`📊 Index: ${INDEX_NAME}`);
  console.log(`🕐 Server time (UTC): ${startTime.toISOString()}`);
  console.log(`🕐 Server time (ICT): ${formatICT(startTime)}`);
  console.log(`📅 Cutoff (UTC): ${cutoffIso}`);
  console.log(`📅 Cutoff (ICT): ${formatICT(cutoffDate)}`);
  console.log(`📅 Cutoff (date): ${cutoffDateOnly}`);

  try {
    // ═══════════════════════════════════════════════════════════
    // 0. Count risk_level distribution BEFORE delete
    // ═══════════════════════════════════════════════════════════
    console.log('\n📊 Counting risk_level distribution (before delete)...');
    const riskBefore = await countRiskLevels(cutoffIso, 'all');
    console.log(`   Risk levels before: L1=${riskBefore[1]} L2=${riskBefore[2]} L3=${riskBefore[3]} L4=${riskBefore[4]} L5=${riskBefore[5]}`);

    console.log('📊 Counting risk_level distribution (to be deleted)...');
    const riskToDelete = await countRiskLevels(cutoffIso, 'old');
    console.log(`   Risk levels to delete: L1=${riskToDelete[1]} L2=${riskToDelete[2]} L3=${riskToDelete[3]} L4=${riskToDelete[4]} L5=${riskToDelete[5]}`);

    // ═══════════════════════════════════════════════════════════
    // 1. Delete from OpenSearch
    // ═══════════════════════════════════════════════════════════
    const indexExists = (await osClient.indices.exists({ index: INDEX_NAME })).body;
    let osDeleted = 0;
    let osBefore = 0;
    let osAfter = 0;

    if (!indexExists) {
      console.log('⚠️  OpenSearch index does not exist, skipping');
    } else {
      osBefore = (await osClient.count({ index: INDEX_NAME })).body.count;
      console.log(`\n📊 OpenSearch total records: ${osBefore}`);

      const countResult = await osClient.count({
        index: INDEX_NAME,
        body: {
          query: {
            range: {
              collected_at: { lt: cutoffIso }
            }
          }
        }
      });

      const toDelete = countResult.body.count;
      console.log(`🗑️  OpenSearch records to delete: ${toDelete}`);

      if (toDelete > 0) {
        console.log('🔄 Deleting from OpenSearch...');
        const deleteResult = await osClient.deleteByQuery({
          index: INDEX_NAME,
          body: {
            query: {
              range: {
                collected_at: { lt: cutoffIso }
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
      } else {
        console.log('✅ No old records in OpenSearch');
      }

      osAfter = (await osClient.count({ index: INDEX_NAME })).body.count;
    }

    // ═══════════════════════════════════════════════════════════
    // 2. Delete from seeker.meta_ad_response (SEEKER)
    // ═══════════════════════════════════════════════════════════
    const adDeleted = await batchDeleteSupabase(
      seekerSupabase, 'seeker', 'meta_ad_response',
      'ad_collected_at', cutoffIso, 'SEEKER ad'
    );

    // ═══════════════════════════════════════════════════════════
    // 3. Delete from seeker.meta_feed_response (SEEKER)
    // ═══════════════════════════════════════════════════════════
    const feedDeleted = await batchDeleteSupabase(
      seekerSupabase, 'seeker', 'meta_feed_response',
      'feed_collected_at', cutoffIso, 'SEEKER feed'
    );

    // ═══════════════════════════════════════════════════════════
    // 4. Delete from api.pageseeker_response_opensearch
    // ═══════════════════════════════════════════════════════════
    const pageseekerDeleted = await batchDeleteSupabase(
      supabase, 'api', TABLE_NAME,
      'collected_at', cutoffIso, 'Pageseeker'
    );

    // ═══════════════════════════════════════════════════════════
    // Final summary
    // ═══════════════════════════════════════════════════════════
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    const totalDeleted = osDeleted + adDeleted + feedDeleted + pageseekerDeleted;

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('✅ Delete Job Completed!');
    console.log(`📊 Results:`);
    console.log(`   🗑️  OpenSearch deleted: ${osDeleted} (${osBefore} → ${osAfter})`);
    console.log(`   🗑️  SEEKER meta_ad_response deleted: ${adDeleted}`);
    console.log(`   🗑️  SEEKER meta_feed_response deleted: ${feedDeleted}`);
    console.log(`   🗑️  Pageseeker response deleted: ${pageseekerDeleted}`);
    console.log(`   📅 Cutoff (TH): ${cutoffDateOnly} 00:00 ICT`);
    console.log(`   ⏱️  Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════');

    // ═══════════════════════════════════════════════════════════
    // 5. Insert log to api.delete_job_log
    // ═══════════════════════════════════════════════════════════
    console.log('\n📝 Saving delete job log...');
    const logEntry = {
      job_run_at: startTime.toISOString(),
      cutoff_date: cutoffIso,
      delete_days: DELETE_DAYS,
      os_before: osBefore,
      os_deleted: osDeleted,
      os_after: osAfter,
      seeker_ad_deleted: adDeleted,
      seeker_feed_deleted: feedDeleted,
      pageseeker_deleted: pageseekerDeleted,
      total_deleted: totalDeleted,
      risk_level_1_before: riskBefore[1],
      risk_level_2_before: riskBefore[2],
      risk_level_3_before: riskBefore[3],
      risk_level_4_before: riskBefore[4],
      risk_level_5_before: riskBefore[5],
      risk_level_1_deleted: riskToDelete[1],
      risk_level_2_deleted: riskToDelete[2],
      risk_level_3_deleted: riskToDelete[3],
      risk_level_4_deleted: riskToDelete[4],
      risk_level_5_deleted: riskToDelete[5],
      duration_seconds: parseFloat(duration)
    };

    const { error: logError } = await supabase
      .schema('api')
      .from('delete_job_log')
      .insert(logEntry);

    if (logError) {
      console.error('   ❌ Failed to save log:', logError.message);
    } else {
      console.log('   ✅ Delete job log saved successfully');
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Delete job failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

deleteOldRecords();
