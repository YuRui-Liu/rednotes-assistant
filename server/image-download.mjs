import { get } from "node:https";
import { AppError } from "./store.mjs";

// Pin the validated DNS answer to the socket. Resolving once for validation and
// again inside fetch would allow DNS rebinding to private network services.
export function downloadPinned(url, addresses, maxBytes) {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = get(
      url,
      {
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(
                null,
                addresses.map((a) => ({
                  address: a.address,
                  family: a.family || (a.address.includes(":") ? 6 : 4),
                })),
              )
            : callback(
                null,
                address.address,
                address.family || (address.address.includes(":") ? 6 : 4),
              ),
        timeout: 30000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new AppError("图片服务响应失败或重定向已拒绝", "UPSTREAM", 502),
          );
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new AppError("图片超过 10MB"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.on("timeout", () =>
      request.destroy(new AppError("图片下载超时", "UPSTREAM", 502)),
    );
    request.on("error", () =>
      reject(new AppError("图片下载失败", "UPSTREAM", 502)),
    );
  });
}
