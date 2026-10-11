/** Whether to offer a made-up update (to try the dialog): the `--fake-update` flag or `AWE_FAKE_UPDATE=1` */
export function wantsFakeUpdate(env: Record<string, string | undefined>, argv: readonly string[]): boolean {
  return env['AWE_FAKE_UPDATE'] === '1' || argv.includes('--fake-update');
}
