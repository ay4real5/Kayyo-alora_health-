import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';

/** One turn of the conversation so far (the dashboard keeps the history; nothing is stored on the server). */
export class AssistantTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}

export class AssistantChatDto {
  /** Oldest first, ending with the new question. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AssistantTurnDto)
  messages!: AssistantTurnDto[];
}

/** A Confirm card the person pressed: the action and the parameters the preview returned (checked again). */
export class AssistantActionDto {
  @IsIn(['assign_caregiver', 'offer_open_shift', 'decide_time_off', 'calculate_payroll', 'export_payroll'])
  kind!: string;

  @IsObject()
  params!: Record<string, unknown>;
}

