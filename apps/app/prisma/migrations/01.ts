import type { Migration } from '../types';

export const up: Migration = async ({ context }) => {
  const revisoins = await context.revisions.findMany();
  console.log(revisoins);
};

export const down: Migration = async ({ context }) => {
  const revisoins = await context.revisions.findMany();
  console.log(revisoins);
};
