import dotenv from 'dotenv';

dotenv.config();

const env = {
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: process.env.DATABASE_URL!,
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT!,
  MINIO_PORT: Number(process.env.MINIO_PORT!),
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY!,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY!,
  MINIO_USE_SSL: process.env.MINIO_USE_SSL === 'true'
};

export default env;