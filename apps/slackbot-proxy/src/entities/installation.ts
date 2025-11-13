import { Installation as SlackInstallation } from '@slack/oauth';
import { Required } from '@tsed/schema';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class Installation {
  @PrimaryGeneratedColumn()
  readonly id: number;

  @Column({ type: 'json' })
  @Required()
  data: SlackInstallation;

  @CreateDateColumn()
  readonly createdAt: Date;

  @UpdateDateColumn()
  readonly updatedAt: Date;

  @Column({ nullable: true })
  isEnterpriseInstall?: boolean;

  @Column({ nullable: true, unique: true })
  teamId?: string;

  @Column({ nullable: true, unique: true })
  enterpriseId?: string;

  setData(slackInstallation: SlackInstallation): void {
    this.data = slackInstallation;

    this.isEnterpriseInstall = slackInstallation.isEnterpriseInstall;
    this.teamId = slackInstallation.team?.id;
    this.enterpriseId = slackInstallation.enterprise?.id;
  }
}
