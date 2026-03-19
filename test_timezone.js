#!/usr/bin/env node

// Test script to verify getCutoffDateTH() calculation

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

// Test the function
console.log('='.repeat(60));
console.log('Testing getCutoffDateTH() function');
console.log('='.repeat(60));

const now = new Date();
console.log(`\nCurrent time (UTC): ${now.toISOString()}`);
console.log(`Current time (ICT): ${formatICT(now)}`);

console.log('\n--- Testing DELETE_DAYS = 1 ---');
const cutoff1 = getCutoffDateTH(1);
console.log(`Cutoff (UTC): ${cutoff1.toISOString()}`);
console.log(`Cutoff (ICT): ${formatICT(cutoff1)}`);
console.log(`Expected: Yesterday 00:00 ICT (= Yesterday 17:00 UTC)`);

console.log('\n--- Testing DELETE_DAYS = 2 ---');
const cutoff2 = getCutoffDateTH(2);
console.log(`Cutoff (UTC): ${cutoff2.toISOString()}`);
console.log(`Cutoff (ICT): ${formatICT(cutoff2)}`);
console.log(`Expected: 2 days ago 00:00 ICT (= 2 days ago 17:00 UTC)`);

console.log('\n--- Verification ---');
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
const thaiNow = new Date(now.getTime() + THAI_OFFSET_MS);
const todayICT = `${thaiNow.getUTCFullYear()}-${String(thaiNow.getUTCMonth() + 1).padStart(2, '0')}-${String(thaiNow.getUTCDate()).padStart(2, '0')}`;
console.log(`Today (ICT): ${todayICT}`);

const cutoffICT = new Date(cutoff1.getTime() + THAI_OFFSET_MS);
const cutoffDateICT = `${cutoffICT.getUTCFullYear()}-${String(cutoffICT.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoffICT.getUTCDate()).padStart(2, '0')}`;
const cutoffTimeICT = `${String(cutoffICT.getUTCHours()).padStart(2, '0')}:${String(cutoffICT.getUTCMinutes()).padStart(2, '0')}:${String(cutoffICT.getUTCSeconds()).padStart(2, '0')}`;
console.log(`Cutoff date (ICT): ${cutoffDateICT} ${cutoffTimeICT}`);
console.log(`Should be: Yesterday 00:00:00`);

console.log('\n' + '='.repeat(60));
