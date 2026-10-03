import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

/**
 * 上传文件的最小类型（dev stub；不依赖 @types/multer）。
 */
export interface UploadedLocalFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

/**
 * 本地上传 stub（dev）：文件存 ./uploads，入库的 fileUrl 记为 `uploads/<文件名>`。
 * 生产需替换为对象存储（S3/OSS 等），并配置静态托管或签名 URL 后再改 fileUrl 生成逻辑。
 * documents 与 teacher（学生照片/头像）共用这一套。
 */
export function LocalFileInterceptor(fieldName = 'file') {
  const dir = join(process.cwd(), 'uploads');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return FileInterceptor(fieldName, {
    storage: diskStorage({
      destination: dir,
      filename: (_req, file, cb) => {
        cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  });
}
