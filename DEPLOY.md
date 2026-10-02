# 舞蹈学校管理系统 · 后端部署说明（D1）

## 准备
- Node.js 20+（推荐 22 LTS）
- Postgres 数据库（已建好：Neon，表结构和种子数据已导入，无需再跑 migrate）

## 方式一：在自己电脑上运行

1. 解压，把 `backend` 文件夹放到你喜欢的位置
2. `cd backend`，然后 `npm install`
3. 复制 `.env.example` 为 `.env`，填入：
   - `DATABASE_URL=` 你的 Neon 连接串（`postgresql://...` 那一整串）
   - `JWT_SECRET=` 随便写一串长的随机字符
4. `npx prisma generate`
5. `npm run start:dev`
6. 浏览器打开 http://localhost:3000/api/v1/health，看到 ok 即成功

测试账号：
- 管理员：admin@danceschool.local / Admin1234!
- 教师：teacher@danceschool.local / Teacher1234!
- 家长：parent@danceschool.local / Parent1234!

登录接口：`POST http://localhost:3000/api/v1/auth/login`
Body：`{"email":"admin@danceschool.local","password":"Admin1234!"}`

## 方式二：部署到 Railway（云端，一直在线）

1. 把 `backend` 文件夹 push 到一个 GitHub 仓库
2. 打开 railway.app，用 GitHub 登录 → New Project → Deploy from GitHub repo，选这个仓库
3. 在 Variables 里添加：
   - `DATABASE_URL` = 你的 Neon 连接串
   - `JWT_SECRET` = 一串长的随机字符
4. 构建命令：`npm install && npx prisma generate && npm run build`
   启动命令：`npm start`
5. Railway 会分配一个公网域名，访问 `https://你的域名/api/v1/health` 看到 ok 即成功

注意：数据库表已通过 SQL 文件建好，部署时不需要再跑 migrate。
