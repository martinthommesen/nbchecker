import { expect, test } from "bun:test";
import { listen } from "bun";
import { Effect } from "effect";
import { response } from "../testing/response.ts";
import { sendTcp } from "./sockets.ts";
import { encodeQuery, responseId } from "./wire.ts";

const lengthPrefix = 2;
const queryId = 7;

test("a TCP answer for a different query is rejected", async () => {
  const server = listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      binaryType: "uint8array",
      data: (socket, data) => {
        const id = (responseId(data.subarray(lengthPrefix)) ?? 0) + 1;
        const body = response({ id });
        const framed = new Uint8Array(body.length + lengthPrefix);
        new DataView(framed.buffer).setUint16(0, body.length);
        framed.set(body, lengthPrefix);
        socket.write(framed);
      },
    },
  });
  try {
    const error = await encodeQuery(queryId, "example.com", "A").pipe(
      Effect.flatMap((q) => sendTcp("127.0.0.1", server.port, q)),
      Effect.flip,
      Effect.runPromise
    );
    expect(error.message).toContain("different query");
  } finally {
    server.stop(true);
  }
});
