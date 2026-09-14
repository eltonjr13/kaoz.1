/**
 * Manifesto da ANATOMIA COMPLETA do CNS (camada de visualização).
 *
 * Não confundir com `topology`, que descreve o recorte que o motor computa.
 * Este endpoint devolve o conjunto anatômico completo (todos os neurônios com
 * posição real) usado apenas para desenhar a referência na interface.
 *
 * O manifesto carrega `purpose: "visualizacao"` e `purposeNotice`, para que a
 * tela possa declarar a diferença em vez de sugerir que o motor processa tudo.
 */

import { apiError, apiSuccess, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';
import {
  AnatomyError,
  readAnatomyManifest,
} from '../../../../../services/cortex-engine/cns-anatomy.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const manifest = await readAnatomyManifest();
    // Só o que a interface precisa: o manifesto público não inclui hashes.
    return apiSuccess({
      artifactId: manifest.artifactId,
      artifactVersion: manifest.artifactVersion,
      datasetId: manifest.datasetId,
      datasetVersion: manifest.datasetVersion,
      license: manifest.license,
      attribution: manifest.attribution,
      purpose: manifest.purpose,
      purposeNotice: manifest.purposeNotice,
      transform: manifest.transform,
      points: manifest.points,
      levels: manifest.levels,
      superclasses: manifest.superclasses,
      motorFrame: manifest.motorFrame ?? null,
    });
  } catch (error) {
    if (error instanceof AnatomyError) {
      console.info(
        '[API Cortex Engine] GET anatomy: anatomia completa não preparada:',
        error.reason
      );
      return apiError(ApiErrorCode.NOT_FOUND, error.message, 404);
    }
    console.error('[API Cortex Engine] GET anatomy:', error);
    return apiError(
      ApiErrorCode.INTERNAL_ERROR,
      'Erro ao carregar a anatomia do CNS.',
      500
    );
  }
}
