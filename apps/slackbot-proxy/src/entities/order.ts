import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Installation } from './installation';

@Entity()
export class Order {
  @PrimaryGeneratedColumn()
  readonly id: number;

  @CreateDateColumn()
  readonly createdAt: Date;

  @UpdateDateColumn()
  readonly updatedAt: Date;

  @ManyToOne(() => Installation)
  readonly installation: Installation;

  @Column({ nullable: true, default: false })
  isCompleted?: boolean;

  @Column()
  growiUrl: string;

  @Column()
  tokenGtoP: string;

  @Column()
  tokenPtoG: string;

  isExpired(): boolean {
    const now = Date.now();
    const expiredAt = this.createdAt.getTime() + 600000;

    return expiredAt < now;
  }
}
