import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsUUID } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  LocalFileInterceptor,
  UploadedLocalFile,
} from '../common/local-upload';
import { RequestUser } from '../common/types';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto, SignDocumentDto } from './dto/document.dto';

class SignatureQueryDto {
  @IsUUID('4', { message: 'student_id 必须是合法的 UUID' })
  student_id: string;
}

/** 文件上传与电子签署路由（§6.24/6.26）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** 上传文件：POST /admin/documents（ADMIN，multipart + file） */
  @Roles(UserRole.ADMIN)
  @Post('admin/documents')
  @UseInterceptors(LocalFileInterceptor())
  create(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file?: UploadedLocalFile,
  ) {
    if (!file) throw new BadRequestException('请上传文件');
    return this.documents.create(req.user.id, dto, file.filename);
  }

  /** 发布新版本：POST /admin/documents/:id/new-version（ADMIN，multipart + file） */
  @Roles(UserRole.ADMIN)
  @Post('admin/documents/:id/new-version')
  @UseInterceptors(LocalFileInterceptor())
  newVersion(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @UploadedFile() file?: UploadedLocalFile,
  ) {
    if (!file) throw new BadRequestException('请上传新版本文件');
    return this.documents.newVersion(req.user.id, id, file.filename);
  }

  /** 文件列表：GET /admin/documents（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/documents')
  list() {
    return this.documents.list();
  }

  /** 签署情况：GET /admin/documents/:id/signatures（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/documents/:id/signatures')
  signatures(@Param('id') id: string) {
    return this.documents.signatures(id);
  }

  /** 待我/孩子签署的文件：GET /me/documents */
  @Get('me/documents')
  pending(@Request() req: { user: RequestUser }) {
    return this.documents.pendingFor(req.user.id);
  }

  /** 电子签署：POST /me/documents/:id/sign */
  @Post('me/documents/:id/sign')
  sign(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: SignDocumentDto,
  ) {
    return this.documents.sign(req.user, id, dto);
  }

  /** 查看签署记录：GET /me/documents/:id/signature?student_id= */
  @Get('me/documents/:id/signature')
  mySignature(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Query() query: SignatureQueryDto,
  ) {
    return this.documents.mySignature(req.user, id, query.student_id);
  }
}
