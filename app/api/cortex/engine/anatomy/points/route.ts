/**
 * Posições da ANATOMIA COMPLETA, em binário.
 *
 * São até 141.781 pontos (1,7 MB). Em JSON isso viraria ~7 MB de texto, então a
 * resposta é o próprio buffer Float32 — o cliente lê direto para um
 * `Float32Array` sem parse.
 *
 * `?level=N` escolhe o nível de detalhe do manifesto (padrão: 0, completo).
 * A redução é por passo determinístico sobre a ordem canônica do arquivo, então
 * o mesmo nível devolve sempre os mesmos pontos.
 */

import { apiError, ApiErrorCode } from '../../../../../../lib/cortex/api-response.ts';
import {
  AnatomyError,
  readAnatomyPositions,
} from '../../../../../../services/cortex-engine/cns-anatomy.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cru = searchParams.get('level');
  const level = cru === null ? 0 : Number.parseInt(cru, 10);

  if (!Number.isInteger(level) || level < 0) {
    return apiError(
      ApiErrorCode.INVALID_PARAMETERS,
      'level precisa ser um inteiro não negativo.',
      400
    );
  }

  try {
    const { positions, points, stride } = await readAnatomyPositions(level);
    // `.slice()` devolve um Uint8Array com ArrayBuffer próprio. Sem isso o tipo é
    // `Uint8Array<ArrayBufferLike>`, que não satisfaz `BodyInit` nas typings atuais.
    const bytes = new Uint8Array(
      positions.buffer,
      positions.byteOffset,
      positions.byteLength
    ).slice();
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store',
        // A interface declara o que está desenhando; estes valores vão no corpo.
        'X-Anatomy-Points': String(points),
        'X-Anatomy-Level': String(level),
        'X-Anatomy-Stride': String(stride),
      },
    });
  } catch (error) {
    if (error instanceof AnatomyError) {
      console.info(
        '[API Cortex Engine] GET anatomy/points: anatomia completa não preparada:',
        error.reason
      );
      return apiError(ApiErrorCode.NOT_FOUND, error.message, 404);
    }
    console.error('[API Cortex Engine] GET anatomy/points:', error);
    return apiError(
      ApiErrorCode.INTERNAL_ERROR,
      'Erro ao carregar as posições da anatomia.',
      500
    );
  }
}
