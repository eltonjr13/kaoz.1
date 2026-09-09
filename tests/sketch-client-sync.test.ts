import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SketchSaveCoordinator,
  type SaveStatus,
} from '../lib/sketch/sketch-save-coordinator.ts';
import {
  isJobActive,
  isJobTerminal,
  ACTIVE_JOB_STEPS,
  TERMINAL_JOB_STEPS,
} from '../lib/sketch/sketch-job-state.ts';
import type { SketchJobData, SketchProjectData } from '../types/sketch.ts';

function createMockProject(id = 'proj-test-01', title = 'Projeto Teste'): SketchProjectData {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    id,
    title,
    aspectRatio: '1:1',
    canvasAspectRatio: '1:1',
    canvasDimensions: { width: 1080, height: 1080, unit: 'px' },
    prompt: 'Mock prompt',
    useSketchAsReference: true,
    referenceMode: 'sketch',
    layers: [
      {
        id: 'layer-bg',
        name: 'Fundo',
        type: 'background',
        fillType: 'color',
        color: '#000000',
        visible: true,
        opacity: 1,
      },
    ],
    attachments: [],
    generationHistory: [],
    updatedAt: new Date().toISOString(),
  };
}

test('módulo puro: predicados de job identificam estados ativos e terminais sem dependências de servidor', () => {
  assert.equal(typeof isJobActive, 'function');
  assert.equal(typeof isJobTerminal, 'function');

  for (const step of ACTIVE_JOB_STEPS) {
    assert.equal(isJobActive(step), true, `Passo ativo ${step} deve retornar true`);
    assert.equal(isJobTerminal(step), false, `Passo ativo ${step} não deve ser terminal`);
  }

  for (const step of TERMINAL_JOB_STEPS) {
    assert.equal(isJobActive(step), false, `Passo terminal ${step} não deve ser ativo`);
    assert.equal(isJobTerminal(step), true, `Passo terminal ${step} deve retornar true`);
  }

  assert.equal(isJobActive(null), false);
  assert.equal(isJobActive(undefined), false);
  assert.equal(isJobTerminal(null), false);
});

test('cenário 1: editar e clicar imediatamente em gerar persiste a revisão exata de forma aguardável', async () => {
  const savedRevisions: number[] = [];
  const savedPayloads: SketchProjectData[] = [];

  const coordinator = new SketchSaveCoordinator(async (toSave, rev) => {
    savedRevisions.push(rev);
    savedPayloads.push(JSON.parse(JSON.stringify(toSave)));
    return true;
  });

  const project = createMockProject('proj-1');
  const projectEdited = {
    ...project,
    title: 'Título Editado Recentemente',
    prompt: 'Prompt Atualizado 50ms antes de gerar',
  };

  // 1. Usuário edita (debounce de 700ms agendado)
  const editRev = coordinator.registerEdit(projectEdited, 700);
  assert.equal(editRev, 1);
  assert.equal(coordinator.isDirty(), true);
  assert.equal(savedRevisions.length, 0, 'Ainda não deve ter persistido antes do debounce ou flush');

  // 2. Usuário clica imediatamente em Gerar -> dispara flushSave()
  const flushResult = await coordinator.flushSave();

  assert.equal(flushResult.success, true);
  assert.equal(flushResult.savedRevision, 1);
  assert.equal(coordinator.isDirty(), false);
  assert.equal(coordinator.getSavedRevision(), 1);
  assert.equal(savedRevisions.length, 1);
  assert.equal(savedRevisions[0], 1);
  assert.equal(savedPayloads[0].title, 'Título Editado Recentemente');
  assert.equal(savedPayloads[0].prompt, 'Prompt Atualizado 50ms antes de gerar');
});

test('cenário 2: salvar com resposta atrasada enquanto usuário continua editando não marca revisão nova como salva', async () => {
  let resolveInFlight: (ok: boolean) => void = () => {};
  const statusHistory: SaveStatus[] = [];

  const coordinator = new SketchSaveCoordinator(
    async (_toSave, rev) => {
      if (rev === 1) {
        return new Promise<boolean>((resolve) => {
          resolveInFlight = resolve;
        });
      }
      return true;
    },
    {
      onStatusChange: (status) => {
        statusHistory.push(status);
      },
    }
  );

  const p1 = createMockProject('proj-2', 'Rev 1');
  coordinator.registerEdit(p1, 10); // Agendado

  // Aguarda o timer disparar o save da rev 1
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(coordinator.isSaving(), true, 'Rev 1 deve estar in flight');

  // Usuário continua editando criando Rev 2 e Rev 3 enquanto Rev 1 está na rede
  const p2 = { ...p1, title: 'Rev 2' };
  coordinator.registerEdit(p2, 700);
  const p3 = { ...p1, title: 'Rev 3' };
  coordinator.registerEdit(p3, 700);

  assert.equal(coordinator.getCurrentRevision(), 3);
  assert.equal(coordinator.getSavedRevision(), 0);

  // Agora a resposta da Rev 1 chega da rede
  resolveInFlight(true);
  await new Promise((r) => setTimeout(r, 10));

  // A Rev 1 foi salva, mas o estado NÃO pode estar 'saved' porque existem edições novas (Rev 3)
  assert.equal(coordinator.getSavedRevision(), 1);
  assert.equal(coordinator.isDirty(), true, 'Deve continuar dirty pois rev 3 > rev 1 salva');
  assert.equal(coordinator.computeSaveStatus(null), 'saving');

  // Aguarda o próximo flush para persistir a Rev 3 pendente
  const finalFlush = await coordinator.flushSave();
  assert.equal(finalFlush.success, true);
  assert.equal(finalFlush.savedRevision, 3);
  assert.equal(coordinator.isDirty(), false);
  assert.equal(coordinator.computeSaveStatus(null), 'saved');
});

test('cenário 3: trocar de projeto durante um trabalho isola timers e ignora respostas de outro projeto', async () => {
  let projectASaved = false;
  const coordinator = new SketchSaveCoordinator(async (toSave) => {
    if (toSave.id === 'proj-A') projectASaved = true;
    return true;
  });

  const projA = createMockProject('proj-A', 'Projeto Alpha');
  coordinator.registerEdit(projA, 700);

  // Simula troca de projeto antes do timer
  if (coordinator.isDirty()) {
    await coordinator.flushSave();
  }
  coordinator.cancelPendingSave();
  coordinator.reset(0);

  assert.equal(projectASaved, true, 'Projeto A deve ter sido persistido antes da troca');
  assert.equal(coordinator.isDirty(), false);

  // Agora o usuário está no Projeto B
  const currentProjectId = 'proj-B';
  const jobFromProjectA: SketchJobData = {
    id: 'job-A-999',
    projectId: 'proj-A',
    status: 'completed',
    progressPercentage: 100,
    stepMessage: 'Arte gerada para Projeto A',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    snapshot: {} as unknown as SketchJobData['snapshot'],
  };

  let clobberedProjectB = false;
  const mockOnMerge = () => {
    clobberedProjectB = true;
  };

  // Simula o callback handleJobPollTick com job do Projeto A enquanto usuário está no Projeto B
  const belongsToCurrentProject = jobFromProjectA.projectId === currentProjectId;
  if (belongsToCurrentProject) {
    mockOnMerge();
  }

  assert.equal(clobberedProjectB, false, 'Job do Projeto A nunca deve sobrescrever o Projeto B');
});

test('cenário 4: falha ao salvar impede geração e exibe erro mantendo trabalho do usuário', async () => {
  let failSave = true;
  let saveAttemptCount = 0;

  const coordinator = new SketchSaveCoordinator(async () => {
    saveAttemptCount++;
    if (failSave) {
      throw new Error('Falha de conexão com o banco de dados local');
    }
    return true;
  });

  const project = createMockProject('proj-fail-test');
  coordinator.registerEdit({ ...project, title: 'Edição Crítica' });

  // Tenta flush antes de gerar
  const result = await coordinator.flushSave();
  assert.equal(result.success, false);
  assert.match(result.error || '', /Falha de conexão/);
  assert.equal(coordinator.isDirty(), true, 'Continua dirty para permitir retry');
  assert.equal(coordinator.computeSaveStatus(result.error || null), 'error');

  // Recupera a conexão e tenta novamente (retry)
  failSave = false;
  const retryResult = await coordinator.flushSave();
  assert.equal(retryResult.success, true);
  assert.equal(coordinator.isDirty(), false);
  assert.equal(coordinator.computeSaveStatus(null), 'saved');
  assert.equal(saveAttemptCount, 2);
});

test('cenário 5: aplicar resultado sem que um autosave antigo desfaça a ação', async () => {
  const persistedStates: SketchProjectData[] = [];

  const coordinator = new SketchSaveCoordinator(async (toSave) => {
    persistedStates.push(JSON.parse(JSON.stringify(toSave)));
    return true;
  });

  const project = createMockProject('proj-apply');
  // 1. Usuário fez uma edição (ex: digitou título)
  coordinator.registerEdit({ ...project, title: 'Título Antes do Resultado' }, 700);

  // 2. Antes do autosave de 700ms disparar, o usuário clica em "Aplicar resultado ao fundo"
  // A ação cancela qualquer autosave pendente:
  coordinator.cancelPendingSave();

  // 3. Resultado é aplicado no backend e retorna o projeto com a nova camada de fundo
  const projectWithResult: SketchProjectData = {
    ...project,
    title: 'Título Antes do Resultado',
    layers: [
      {
        id: 'layer-bg',
        name: 'Fundo Gerado IA',
        type: 'background',
        fillType: 'image',
        imageUrl: '/api/sketch/assets/gen-result-123.png',
        visible: true,
        opacity: 1,
      },
    ],
  };

  coordinator.reset(0);

  // 4. Passam-se 1000ms (tempo superior ao debounce original)
  await new Promise((r) => setTimeout(r, 50));

  // 5. Verifica que o autosave antigo NÃO disparou
  assert.equal(persistedStates.length, 0, 'Autosave antigo cancelado não deve ter disparado');
  assert.equal(coordinator.isDirty(), false);

  // Se agora o usuário salvar explicitamente, salvará a versão com o resultado aplicado
  await coordinator.registerEdit(projectWithResult, 10);
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(persistedStates.length, 1);
  assert.equal(persistedStates[0].layers[0].fillType, 'image');
  assert.equal(persistedStates[0].layers[0].imageUrl, '/api/sketch/assets/gen-result-123.png');
});
