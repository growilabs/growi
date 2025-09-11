import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class SystemInformation {
  @PrimaryGeneratedColumn()
  readonly id: number;

  @Column({ nullable: false })
  version: string;

  @CreateDateColumn()
  readonly createdAt: Date;

  @UpdateDateColumn()
  readonly updatedAt: Date;

  setVersion(version: string): void {
    this.version = version;
  }
}
