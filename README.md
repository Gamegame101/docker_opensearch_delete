# docker_opensearch_delete

Cronjob Docker container สำหรับลบข้อมูลใน OpenSearch ที่ `collected_at` เก่ากว่า 7 วัน

## Flow

```
Start Container
  → ตรวจสอบ index exists
  → นับ records ที่เก่ากว่า 7 วัน
  → deleteByQuery (collected_at < cutoff)
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
| `DELETE_DAYS` | จำนวนวันที่จะเก็บ (default: 7) | `7` |

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
