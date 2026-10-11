/** One GitHub release as the update check reads it */
export interface Release {
  /** The git tag, such as `v0.7.0` */
  tag: string;
  /** The release's title; null when GitHub has none */
  name: string | null;
  /** The release notes (markdown); null when empty */
  body: string | null;
  /** The release's page on GitHub */
  url: string;
  prerelease: boolean;
  draft: boolean;
}

/** What one release changed, as the update dialog lists it */
export interface ReleaseNote {
  /** `0.7.0`, with no leading v */
  version: string;
  /** The release's name, or its tag when it has none */
  title: string;
  /** The notes (markdown); empty when there are none */
  body: string;
  url: string;
}

/** A newer release the user can be told about */
export interface UpdateOffer {
  /** The installed version */
  current: string;
  /** The newest published version */
  latest: string;
  /** The newest release's page, where the Update button goes */
  releaseUrl: string;
  /** Every release after the installed one up to the newest, newest first */
  notes: ReleaseNote[];
}
