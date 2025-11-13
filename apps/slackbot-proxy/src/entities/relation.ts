import { differenceInMilliseconds } from 'date-fns/differenceInMilliseconds';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Installation } from './installation';

export interface PermissionSettingsInterface {
  [commandName: string]: boolean | string[];
}

@Entity()
@Index(['installation', 'growiUri'], { unique: true })
export class Relation {
  @PrimaryGeneratedColumn()
  readonly id: number;

  @CreateDateColumn()
  readonly createdAt: Date;

  @UpdateDateColumn()
  readonly updatedAt: Date;

  @ManyToOne(() => Installation)
  readonly installation: Installation;

  @Column()
  @Index({ unique: true })
  tokenGtoP: string;

  @Column()
  @Index()
  tokenPtoG: string;

  @Column()
  growiUri: string;

  @Column({ type: 'json' })
  permissionsForBroadcastUseCommands: PermissionSettingsInterface;

  @Column({ type: 'json' })
  permissionsForSingleUseCommands: PermissionSettingsInterface;

  @Column({ type: 'timestamp' })
  expiredAtCommands: Date;

  getDistanceInMillisecondsToExpiredAt(baseDate: Date): number {
    return differenceInMilliseconds(this.expiredAtCommands, baseDate);
  }
}
