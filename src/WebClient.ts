import type { IncomingHttpHeaders } from 'http';
import { request as requestHttp } from 'http';
import type { RequestOptions as InternalRequestOptions } from 'https';
import { request as requestHttps } from 'https';
import * as Http from './Http';

interface InternalResponse {
  /**
   * HTTP headers.
   */
  headers: IncomingHttpHeaders;

  /**
   * Raw response body.
   */
  rawData: string;

  /**
   * HTTP status code.
   */
  statusCode: number;

  /**
   * HTTP status message.
   */
  statusMessage: string;

  /**
   * HTTP trailers.
   */
  trailers: Record<string, string | undefined>;
}

interface RequestOptions {
  /**
   * HTTP request method.
   */
  method?: Http.Method;

  /**
   * Request URL. If it doesn't include a protocol, the client's `baseUrl` is prepended to it, with a joining slash if necessary.
   */
  url: string;
}

interface Response extends InternalResponse {
  /**
   * Request options that resulted in this response.
   */
  requestOptions: Readonly<RequestOptions>;
}

interface WebClientOptions {
  /**
   * Base URL that will be prepended to request URLs. Must include a protocol.
   */
  baseUrl?: string;

  /**
   * Default HTTP request method.
   *
   * @defaultValue `"GET"`
   */
  defaultMethod?: Http.Method;

  /**
   * Rate limiter that wraps the request function.
   */
  limiter?: (fn: typeof asyncRequest) => typeof asyncRequest;
}

function hasProtocol(url: string): boolean {
  return /^https?:/.test(url);
}

function hasSecureProtocol(url: string): boolean {
  return url.startsWith('https:');
}

async function asyncRequest(
  url: string,
  options: Readonly<InternalRequestOptions>,
  body: unknown,
  secure: boolean,
): Promise<InternalResponse> {
  const performRequest = secure ? requestHttps : requestHttp;

  return new Promise<InternalResponse>(function (resolve, reject) {
    const request = performRequest(url, options, function (response) {
      let result = '';

      response.on('data', function (chunk) {
        result += chunk;
      });

      response.on('end', function () {
        resolve({
          headers: response.headers,
          rawData: result,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          statusCode: response.statusCode!,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          statusMessage: response.statusMessage!,
          trailers: response.trailers,
        });
      });

      response.on('error', reject);
    });

    request.on('error', reject);

    if (body != null) {
      request.write(body, reject);
    }

    request.end();
  });
}

function fillRequestOptionDefaults(
  options: Readonly<RequestOptions>,
  clientOptions: Readonly<WebClientOptions>,
): Readonly<RequestOptions> {
  const newOptions: RequestOptions = {
    method: clientOptions.defaultMethod ?? Http.Method.get,
    ...options,
  };

  if (!hasProtocol(options.url)) {
    if (clientOptions.baseUrl == null) {
      throw new TypeError(
        "`url` doesn't include a protocol and `baseUrl` isn't set",
      );
    }

    newOptions.url =
      clientOptions.baseUrl.replace(/\/*$/, '/') +
      options.url.replace(/^\/+/, '');
  }

  return newOptions;
}

/**
 * A client used to communicate over HTTP(S).
 */
export default class WebClient {
  private readonly options: WebClientOptions;
  private readonly requestFn: typeof asyncRequest;

  public constructor(options: Readonly<WebClientOptions>) {
    if (options.baseUrl != null && !hasProtocol(options.baseUrl)) {
      throw new TypeError("`baseUrl` doesn't include a protocol");
    }

    this.requestFn =
      options.limiter != null ? options.limiter(asyncRequest) : asyncRequest;
    this.options = options;
  }

  /**
   * Creates a new web client using the configuration of this client.
   *
   * @param options - Web client options.
   * @returns A new web client.
   */
  public extend(options?: Readonly<WebClientOptions>): WebClient {
    return new WebClient({ ...this.options, ...options });
  }

  /**
   * Sends an HTTP request.
   *
   * @param options - Request options. Unset options default to the web client options.
   * @returns A promise of an HTTP response.
   */
  public async request(
    options: Readonly<RequestOptions>,
  ): Promise<Readonly<Response>> {
    const filledOptions = fillRequestOptionDefaults(options, this.options);
    const internalResponse = await this.requestFn(
      filledOptions.url,
      { method: filledOptions.method },
      undefined,
      hasSecureProtocol(filledOptions.url),
    );

    return {
      ...internalResponse,
      requestOptions: filledOptions,
    };
  }
}
