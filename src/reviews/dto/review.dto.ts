import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/** 发布课程整体要求评价（§6.13） */
export class CreateCourseReviewDto {
  @IsString({ message: 'content 必须是字符串' })
  @IsNotEmpty({ message: 'content 不能为空' })
  content: string;
}

/** 发布学员个人评价（§6.14）：{ class_session_id, content } */
export class CreateStudentReviewDto {
  @IsUUID('4', { message: 'class_session_id 必须是合法的 UUID' })
  class_session_id: string;

  @IsString({ message: 'content 必须是字符串' })
  @IsNotEmpty({ message: 'content 不能为空' })
  content: string;
}
