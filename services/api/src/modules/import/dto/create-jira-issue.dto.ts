import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateJiraIssueDto {
  @ApiProperty({ example: 'ITAT', description: 'Jira project key' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  projectKey: string;

  @ApiProperty({ example: 'MWK-37: outbound Jira create workflow' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  summary: string;

  @ApiPropertyOptional({ example: 'Optional description body' })
  @IsOptional()
  @IsString()
  @MaxLength(32000)
  description?: string;

  @ApiPropertyOptional({ example: 'Task', default: 'Task' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  issueTypeName?: string;
}
