import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { PatientsModule } from '../patients/patients.module.js';
import { DatabaseDocumentStorage, DocumentStorage } from './document-storage.js';
import { DocumentsService, type UploadedFile as File } from './documents.service.js';
import {
  DeleteDocumentDto,
  ListDocumentsQueryDto,
  SignDocumentDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './dto/documents.dto.js';
import { MAX_DOCUMENT_BYTES } from './file-type.js';

const uuid = () => new ParseUUIDPipe();

/** Documents (DESIGN.md §6.9, DECISIONS D-056). Faxing waits for a fax provider. */
@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Permissions('documents:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListDocumentsQueryDto) {
    return this.documents.list(caller, query);
  }

  /** multipart/form-data: `file` plus the fields. PDF, PNG, JPEG or .docx, up to 10 MB. */
  @Permissions('documents:create')
  @Audit({ action: 'UPLOAD_DOCUMENT', resourceType: 'documents' })
  @ApiConsumes('multipart/form-data')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 } }),
  )
  upload(
    @CurrentUser() caller: AuthUser,
    @UploadedFile() file: File | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documents.upload(caller, file, dto);
  }

  @Permissions('documents:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.documents.get(caller, id);
  }

  @Permissions('documents:read')
  @Get(':id/versions')
  versions(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.documents.versions(caller, id);
  }

  /** The file itself (attachment). Every download is audited. */
  @Permissions('documents:read')
  @Audit({ action: 'DOWNLOAD_DOCUMENT', resourceType: 'documents' })
  @Get(':id/download')
  async download(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    const file = await this.documents.download(caller, id);
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.content.length,
    });
  }

  @Permissions('documents:sign')
  @Audit({ action: 'SIGN_DOCUMENT', resourceType: 'documents' })
  @Post(':id/sign')
  @HttpCode(HttpStatus.OK)
  sign(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Body() dto: SignDocumentDto,
    @Req() req: Request,
  ) {
    return this.documents.sign(caller, id, dto.typedName, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
  }

  /** Show or hide it in the patient portal (D-058). */
  @Permissions('documents:create')
  @Audit({ action: 'UPDATE_DOCUMENT_SHARING', resourceType: 'documents' })
  @Patch(':id')
  update(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: UpdateDocumentDto) {
    return this.documents.setSharing(caller, id, dto.sharedWithPatient);
  }

  /** Soft delete with a reason; the record and file are kept. */
  @Permissions('documents:delete')
  @Audit({ action: 'DELETE_DOCUMENT', resourceType: 'documents' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Body() dto: DeleteDocumentDto,
  ) {
    return this.documents.remove(caller, id, dto.reason);
  }
}

@Module({
  imports: [PatientsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, { provide: DocumentStorage, useClass: DatabaseDocumentStorage }],
  exports: [DocumentsService],
})
export class DocumentsModule {}
