# docker_opensearch_delete

Cronjob Docker container สำหรับลบข้อมูลเก่ากว่า N วัน (ตามเวลาไทย) จาก 4 แหล่ง:
1. **OpenSearch** index `pageseeker_response_opensearch`
2. **SEEKER** table `seeker.meta_ad_response` (by `ad_collected_at`)
3. **SEEKER** table `seeker.meta_feed_response` (by `feed_collected_at`)
4. **Pageseeker-service** table `api.pageseeker_response_opensearch` (by `collected_at`)

## Flow

```
Start Container
  → คำนวณ cutoff date ตามเวลาไทย (UTC+7)
  → ลบจาก OpenSearch (collected_at < cutoff)
  → ลบจาก seeker.meta_ad_response (ad_collected_at < cutoff)
  → ลบจาก seeker.meta_feed_response (feed_collected_at < cutoff)
  → ลบจาก api.pageseeker_response_opensearch (collected_at < cutoff)
  → แสดงผลลัพธ์
  → Exit (container ปิดตัว)
```

## Environment Variables (ตั้งใน Render)

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENSEARCH_NODE` | AWS OpenSearch endpoint | `https://search-xxx.es.amazonaws.com` |
| `S3_REGION` | AWS region (ใช้สำหรับ SigV4) | `ap-southeast-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | `ja63...` |
| `SUPABASE_URL` | Pageseeker-service Supabase URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Pageseeker-service service role key | `eyJ...` |
| `SEEKER_SUPABASE_URL` | SEEKER Supabase URL | `https://xxx.supabase.co` |
| `SEEKER_SUPABASE_KEY` | SEEKER service role key | `eyJ...` |
| `DELETE_DAYS` | จำนวนวันที่จะเก็บ ตามเวลาไทย (default: 1) | `1` |

## Deploy to Render (Cron Job)

1. สร้าง **Cron Job** ใน Render
2. เลือก Docker runtime
3. ชี้ไปที่ folder `docker_opensearch_delete`
4. ตั้ง Environment Variables ตามตาราง
5. ตั้ง Schedule เช่น `0 3 * * *` (ตี 3 ทุกวัน)
6. Container จะลบข้อมูลเก่าแล้วปิดตัวเองเมื่อเสร็จ

## Build & Test Local

```bash
# Build
docker build -t opensearch-delete-job .

# Run (ต้องมี .env file)
docker run --env-file ../.env opensearch-delete-job

# Run with custom days
docker run --env-file ../.env -e DELETE_DAYS=14 opensearch-delete-job
```
