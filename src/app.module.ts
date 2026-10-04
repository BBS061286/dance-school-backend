import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AttendanceModule } from './attendance/attendance.module';
import { BillingModule } from './billing/billing.module';
import { CampusesModule } from './campuses/campuses.module';
import { TermsModule } from './terms/terms.module';
import { SessionsModule } from './sessions/sessions.module';
import { CoursesModule } from './courses/courses.module';
import { DocumentsModule } from './documents/documents.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { EventsModule } from './events/events.module';
import { ExtraLessonsModule } from './extra-lessons/extra-lessons.module';
import { HealthModule } from './health/health.module';
import { InstructorsModule } from './instructors/instructors.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { MakeupModule } from './makeup/makeup.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationCenterModule } from './notifications/notification-center.module';
import { PrismaModule } from './prisma/prisma.module';
import { MigrationService } from './database/migration.service';
import { RemindersModule } from './reminders/reminders.module';
import { ReviewsModule } from './reviews/reviews.module';
import { StudentsModule } from './students/students.module';
import { TeacherModule } from './teacher/teacher.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    HealthModule,
    UsersModule,
    IntegrationsModule,
    EnrollmentsModule, // D2：报名 / 候补 / 名单
    BillingModule, // D2：订单 / 支付流水 / 退款
    WebhooksModule, // D2：Stripe webhook
    RemindersModule, // D3：提醒规则管理 + ReminderLog 查询
    AttendanceModule, // D4：课次 / 打卡 / 教师打卡
    MakeupModule, // D4：补课资格 / 预约
    ExtraLessonsModule, // D4：加课申请 / 时段审批
    EventsModule, // D4：活动 / 报名 / 门票 / 通知群发
    NotificationCenterModule, // D5：统一通知中心
    ReviewsModule, // D5：课程评价 / 学员私密评价
    TeacherModule, // D5：教师端
    MessagingModule, // D5：私信
    DocumentsModule, // D5：文件签署
    StudentsModule, // D5：学员查询
    CoursesModule, // D5：课程创建
    InstructorsModule, // D5：教师管理
    CampusesModule,
    TermsModule, // 学期管理
    SessionsModule, // 班次管理：新建班次
  ],
  providers: [
    // 全局守卫：先鉴权（@Public 标记的路由放行），再做角色校验
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    MigrationService, // 开机自动跑 prisma/manual-migrations/*.sql
  ],
})
export class AppModule {}
