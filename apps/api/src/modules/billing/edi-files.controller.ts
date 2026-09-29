import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { CreateEdiFileDto, Upload835Dto } from './dto/claims.dto.js';
import { EdiFilesService } from './edi-files.service.js';

const uuid = () => new ParseUUIDPipe();

/** Claim files and acknowledgments (DECISIONS D-076). */
@ApiTags('billing')
@Controller('billing/edi-files')
export class EdiFilesController {
  constructor(private readonly files: EdiFilesService) {}

  @Permissions('billing:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: PaginationQueryDto) {
    return this.files.list(caller, query);
  }

  /** One 837 file from ready claims to one payer, with the agency's next control number. 422 lists what's missing. */
  @Permissions('billing:create')
  @Audit({ action: 'CREATE_837_FILE', resourceType: 'edi_files' })
  @Post('837')
  create837(@CurrentUser() caller: AuthUser, @Body() dto: CreateEdiFileDto) {
    return this.files.create837(caller, dto.claimIds, dto.test ?? false);
  }

  /** A 999 or 277CA from the clearinghouse, applied to our files and claims. */
  @Permissions('billing:create')
  @Audit({ action: 'UPLOAD_ACKNOWLEDGMENT', resourceType: 'edi_files' })
  @Post('upload-ack')
  uploadAck(@CurrentUser() caller: AuthUser, @Body() dto: Upload835Dto) {
    return this.files.uploadAck(caller, dto.fileName, dto.content);
  }

  @Permissions('billing:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.files.get(caller, id);
  }

  @Permissions('billing:read')
  @Audit({ action: 'DOWNLOAD_EDI_FILE', resourceType: 'edi_files' })
  @Get(':id/download')
  download(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.files.download(caller, id);
  }

  /** The file was uploaded to the clearinghouse: its claims become submitted. */
  @Permissions('billing:submit')
  @Audit({ action: 'SUBMIT_837_FILE', resourceType: 'edi_files' })
  @Post(':id/sent')
  @HttpCode(HttpStatus.OK)
  markSent(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.files.markSent(caller, id);
  }
}
