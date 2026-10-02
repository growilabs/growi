export function hasProcessFlag(flag: string): boolean {
  return process.argv.join('').indexOf(flag) > -1;
}
