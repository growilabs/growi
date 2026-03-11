import type { Migration } from '../index';

export const up: Migration = async ({ context }) => {
  const revisoins = await context.revisions.findMany();
  console.log(revisoins);
};

export const down: Migration = async ({ context }) => {
  const revisoins = await context.revisions.findMany();
  console.log(revisoins);
};
