/**
 * @fileoverview tools for implementing the HTTP-based Internet Computer Identity Protocol, which is mostly a profile of OpenID Connect (OIDC), which is a profile of OAuth2.
 */
import { PublicKey, derBlobFromBlob, blobFromHex } from '@dfinity/agent';
import { OAuth2AccessTokenResponse } from './oauth2';
import * as oauth2 from './oauth2';
import * as assert from 'assert';
import { hexEncodeUintArray, hexToBytes } from '../bytes';
import { DelegationChain } from '@dfinity/authentication';

/**
 * RP's build this, then (logically) send it to the Identity Provider, then hope for an AuthenticationResponse in return.
 */
export type AuthenticationRequest = {
  type: 'AuthenticationRequest';
  sessionIdentity: {
    hex: string;
  };
  redirectUri: string;
  state?: string;
  scope: string;
};

export interface AuthenticationResponse {
  type: 'AuthenticationResponse';
  accessToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  // @TODO - implement
  state?: string;
  // @TODO - implement
  scope?: string;
}

/**
 * Convert an IC-IDP-internal message to an OAuth2-compliant one.e
 * (e.g. to snake_case keys instead of JS-conventional camelCase)
 */
export function toOAuth2(message: AuthenticationResponse) {
  const {
    accessToken: access_token,
    expiresIn: expires_in,
    tokenType: token_type,
    state,
  } = message;
  const oauth2AccessTokenResponse: OAuth2AccessTokenResponse = {
    access_token,
    expires_in,
    token_type,
    state,
  };
  return oauth2AccessTokenResponse;
}

type OAuthTypeToIdpType<T> = T extends oauth2.OAuth2AuthorizationRequest
  ? AuthenticationResponse
  : T extends oauth2.OAuth2AccessTokenResponse
  ? AuthenticationRequest
  : never;

type OAuth2Mesage = oauth2.OAuth2AccessTokenResponse | oauth2.OAuth2AuthorizationRequest;

function AuthenticationResponse(input: oauth2.OAuth2AccessTokenResponse): AuthenticationResponse {
  const response: AuthenticationResponse = {
    type: 'AuthenticationResponse',
    accessToken: input.access_token,
    tokenType: input.token_type || 'bearer',
    expiresIn: input.expires_in,
    state: input.state,
    scope: input.scope,
  };
  return response;
}

function AuthenticationRequest(input: oauth2.OAuth2AuthorizationRequest): AuthenticationRequest {
  console.log('AuthenticationRequest', input);
  const request: AuthenticationRequest = {
    type: 'AuthenticationRequest',
    sessionIdentity: {
      hex: input.login_hint,
    },
    redirectUri: new URL(input.redirect_uri).toString(),
    state: input.state,
    scope: input.scope || '',
  };
  return request;
}

/**
 * Parse a ICAuthenticationResponse from an OAuth2 redirect_uri-targeted querystring.
 */
export function fromQueryString(
  searchParams: URLSearchParams,
): undefined | AuthenticationRequest | AuthenticationResponse {
  const oauth2Message = oauth2.fromQueryString(searchParams);
  if (!oauth2Message) return;
  if ('access_token' in oauth2Message) {
    return AuthenticationResponse(oauth2Message);
  }
  return AuthenticationRequest(oauth2Message);
}

function decodeUtf8(bytes: Uint8Array): string {
  const TextDecoder = globalThis.TextDecoder || require('util').TextDecoder;
  return new TextDecoder().decode(bytes);
}

interface IParsedBearerToken {
  publicKey: string;
  delegations: Array<{
    delegation: {
      expiration: string;
      pubkey: string;
    };
    signature: string;
  }>;
}

/**
 * Parse a Bearer token from IC IDP oauth2 AccessTokenResponse into the IC info relatd to sender_delegation
 * @param icIdpBearerToken {string} hex-encoded utf8 JSON generated by @dfinity/agent `DelegationChain.toJSON()`
 */
export function parseBearerToken(icIdpBearerToken: string): IParsedBearerToken {
  const bytes = hexToBytes(icIdpBearerToken);
  const json = decodeUtf8(bytes);
  const parsed = JSON.parse(json);
  const publicKey = parsed.publicKey as unknown;
  const delegations = parsed.delegations as unknown;
  if (typeof publicKey !== 'string') {
    throw new Error('publicKey must be a string');
  }
  assert.ok(delegations);
  const result: IParsedBearerToken = {
    publicKey,
    delegations: delegations as IParsedBearerToken['delegations'],
  };
  return parsed;
}

/**
 * Create a Bearer Token to encode the result of IC Authentication
 */
export function createBearerToken(spec: { delegationChain: DelegationChain }): string {
  // delegationChain.toJSON | JSON.stringify | utf8Encode | hex
  const bearerToken = hexEncodeUintArray(
    new TextEncoder().encode(JSON.stringify(spec.delegationChain)),
  );
  return bearerToken;
}

/** Convert an ic-id-protocol request to an OAuth 2.0 compliant request (just syntax transformation really) */
export function toOauth(idpRequest: AuthenticationRequest): oauth2.OAuth2AuthorizationRequest {
  const login_hint: string = idpRequest.sessionIdentity.hex;
  const redirect_uri: string = idpRequest.redirectUri.toString();
  const oauthRequest: oauth2.OAuth2AuthorizationRequest = {
    response_type: 'token',
    login_hint,
    redirect_uri,
    scope: idpRequest.scope,
    state: idpRequest.state,
  };
  return oauthRequest;
}

/**
 * Create a full URL to submit an AuthenticationRequest to an Identity Provider
 */
export function createAuthenticationRequestUrl(spec: {
  identityProviderUrl: URL;
  authenticationRequest: AuthenticationRequest;
}): URL {
  const url = new URL(spec.identityProviderUrl.toString());
  for (const [key, value] of Object.entries(toOauth(spec.authenticationRequest))) {
    url.searchParams.set(key, value);
  }
  return url;
}