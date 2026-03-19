# Timezone Fix Summary - docker_opensearch_delete

## Problem Fixed
The `getCutoffDateTH()` function was incorrectly calculating the cutoff date for Thailand timezone, causing inconsistent deletions between OpenSearch and Supabase databases.

## Changes Made

### 1. Fixed `getCutoffDateTH()` function
**File:** `delete_old_records.js` (lines 68-91)

**Before:** The function incorrectly used `Date.UTC()` after shifting timezone, resulting in midnight UTC instead of midnight ICT.

**After:** Properly calculates:
1. Current time in Thailand (UTC+7)
2. Start of today at 00:00 ICT
3. Subtracts the specified number of days
4. Converts back to UTC for database queries

### 2. Added `formatICT()` helper function
**File:** `delete_old_records.js` (lines 61-66)

Formats dates in ICT timezone for better logging and debugging.

### 3. Enhanced logging
**File:** `delete_old_records.js` (lines 165-168)

Now displays:
- Server time in both UTC and ICT
- Cutoff date in both UTC and ICT
- Makes it easy to verify the calculation is correct

## Verification

Test results from `test_timezone.js`:
```
Current time (UTC): 2026-03-19T03:40:37.490Z
Current time (ICT): 2026-03-19 10:40:37.490 ICT

DELETE_DAYS = 1:
Cutoff (UTC): 2026-03-17T17:00:00.000Z
Cutoff (ICT): 2026-03-18 00:00:00.000 ICT ✅ Correct!
```

## Expected Behavior

With `DELETE_DAYS=1`:
- **Deletes:** Records with `collected_at < Yesterday 00:00 ICT`
- **Example:** On March 19, 2026 at 10:33 ICT, deletes records older than March 18, 2026 00:00 ICT

## Impact

✅ OpenSearch and all Supabase tables now use the **same cutoff date**
✅ Cutoff is correctly calculated based on **Thailand timezone**
✅ Better logging for debugging timezone issues

## Files Modified

1. `delete_old_records.js` - Fixed timezone calculation and enhanced logging
2. `test_timezone.js` - New test script to verify calculations (can be run anytime)
