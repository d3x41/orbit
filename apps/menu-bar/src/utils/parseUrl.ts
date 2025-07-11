import { Platform } from 'react-native';

import { saveSessionSecret } from '../modules/Storage';

export const getPlatformFromURI = (url: string): 'android' | 'ios' => {
  return url.endsWith('.apk') ? 'android' : 'ios';
};

export function handleAuthUrl(url: string) {
  const resultURL = new URL(url);
  const sessionSecret = resultURL.searchParams.get('session_secret');

  if (!sessionSecret) {
    throw new Error('session_secret is missing in auth redirect query');
  }

  saveSessionSecret(sessionSecret);
}
type BaseDeeplinkURLType = {
  urlType: Exclude<URLType, URLType.GO>;
  url: string;
};

type GoDeeplinkURLType = {
  urlType: URLType.GO;
  url: string;
  sdkVersion: string | null;
};

type DeeplinkURLType = BaseDeeplinkURLType | GoDeeplinkURLType;

export function identifyAndParseDeeplinkURL(deeplinkURLString: string): DeeplinkURLType {
  // Replace double slash URLs with triple slash to support Slack and other deeplink previews
  const tripleSlashURL = deeplinkURLString.replace(
    /^([^:]+:\/\/)(auth|update|download|go|snack)/,
    '$1/$2'
  );

  /**
   * The URL implementation when running Jest does not support
   * custom schemes + URLs without domains. That's why we
   * default to http://expo.dev when creating a new URL instance.
   */
  const urlWithoutProtocol = tripleSlashURL.replace(/^[^:]+:\/\//, '');
  const deeplinkURL = new URL(
    Platform.OS === 'web'
      ? urlWithoutProtocol
      : // Replace double slash URLs with triple slash to please the URL parser
        tripleSlashURL,
    'http://expo.dev'
  );
  // On web the pathname starts with '///' instead of '/'
  const pathname = deeplinkURL.pathname.replace('///', '/');

  if (pathname.startsWith('/auth')) {
    return { urlType: URLType.AUTH, url: deeplinkURLString };
  }
  if (pathname.startsWith('/update')) {
    return {
      urlType: URLType.EXPO_UPDATE,
      url: getUrlFromSearchParams(deeplinkURL.searchParams),
    };
  }
  if (pathname.startsWith('/download')) {
    return {
      urlType: URLType.EXPO_BUILD,
      url: getUrlFromSearchParams(deeplinkURL.searchParams),
    };
  }
  if (pathname.startsWith('/go')) {
    return {
      urlType: URLType.GO,
      url: getUrlFromSearchParams(deeplinkURL.searchParams),
      sdkVersion: deeplinkURL.searchParams.get('sdkVersion'),
    };
  }
  // Deprecate in future versions
  if (pathname.startsWith('/snack')) {
    return {
      urlType: URLType.SNACK,
      url: getUrlFromSearchParams(deeplinkURL.searchParams),
    };
  }

  // For future usage when we add support for other URL formats
  if (
    urlWithoutProtocol.indexOf('/') < urlWithoutProtocol.indexOf('.') ||
    !urlWithoutProtocol.includes('.')
  ) {
    throw new Error('Please make sure you are using the latest version of Expo Orbit.');
  }

  throw new Error('Unsupported URL');
}

function getUrlFromSearchParams(searchParams: URLSearchParams): string {
  const url = searchParams.get('url');
  if (!url) {
    throw new Error('Missing url parameter in query');
  }
  return url;
}

export enum URLType {
  AUTH = 'AUTH',
  EXPO_UPDATE = 'EXPO_UPDATE',
  EXPO_BUILD = 'EXPO_BUILD',
  SNACK = 'SNACK',
  GO = 'GO',
  UNKNOWN = 'UNKNOWN',
}
