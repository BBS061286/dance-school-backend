import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * 编辑自己资料（§6.10）：
 * - name / preferredCampusIds 直接写 User
 * - 年龄是双写入口：传 dob（推荐）或 age；服务端统一反算 dob 并写入
 *   SELF 绑定的 Student.dob（年龄的唯一事实来源，GET /me 的 age 计算不动）
 */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** 出生日期（推荐） */
  @IsOptional()
  @IsDateString()
  dob?: string;

  /** 周岁；服务端按"今天减去 age 年"反算 dob */
  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number;

  /** 常去/可参加的校区（多选） */
  @IsOptional()
  @IsUUID('4', { each: true })
  preferred_campus_ids?: string[];
}
