import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhatsAppChat, filterParticipantMessages } from '../lib/model-p/chat-parser.ts';
import { extractStylometry } from '../lib/model-p/persona-extractor.ts';

const SAMPLE_ANDROID_CHAT = `
12/03/2024, 10:15 - As mensagens e chamadas são protegidas com a criptografia de ponta a ponta.
12/03/2024, 10:16 - Carlos Silva: Fala meu amigo, blz?
12/03/2024, 10:17 - Elton: Opa Carlos, tudo ótimo por aqui! E vc?
12/03/2024, 10:18 - Carlos Silva: tudo certo mano!
fechou aquele projeto la? 🔥
12/03/2024, 10:19 - Carlos Silva: <Arquivo de mídia oculto>
12/03/2024, 10:20 - Elton: Fechamos sim, ficou top demais!
12/03/2024, 10:21 - Carlos Silva: showww mano, valeu mesmo!! 🚀🔥
`;

const SAMPLE_IOS_CHAT = `
[15/04/2024, 14:00:10] Mariana: oi tudo bem?
[15/04/2024, 14:01:05] Elton: Oi Mariana, tudo certinho!
[15/04/2024, 14:01:40] Mariana: vc viu o documento que mandei ontem...?
[15/04/2024, 14:02:15] Mariana: achei bem legal 🥰
`;

describe('Model P - WhatsApp Chat Parser & Isolation', () => {
  it('parses Android WhatsApp export format and ignores system messages', () => {
    const result = parseWhatsAppChat(SAMPLE_ANDROID_CHAT);

    assert.equal(result.participants.length, 2);
    const carlos = result.participants.find((p) => p.name === 'Carlos Silva');
    const elton = result.participants.find((p) => p.name === 'Elton');

    assert.ok(carlos, 'Carlos Silva deve existir');
    assert.ok(elton, 'Elton deve existir');
    assert.equal(carlos.messageCount, 3);
    assert.equal(elton.messageCount, 2);
  });

  it('parses multiline messages correctly without dropping continuous lines', () => {
    const result = parseWhatsAppChat(SAMPLE_ANDROID_CHAT);
    const multiline = result.messages.find((m) => m.content.includes('fechou aquele projeto la?'));

    assert.ok(multiline);
    assert.ok(multiline.content.includes('tudo certo mano!'));
    assert.ok(multiline.content.includes('fechou aquele projeto la?'));
  });

  it('parses iOS bracketed WhatsApp export format correctly', () => {
    const result = parseWhatsAppChat(SAMPLE_IOS_CHAT);

    assert.equal(result.participants.length, 2);
    const mariana = result.participants.find((p) => p.name === 'Mariana');
    assert.ok(mariana);
    assert.equal(mariana.messageCount, 3);
  });

  it('strictly isolates messages of the chosen participant without contamination', () => {
    const result = parseWhatsAppChat(SAMPLE_ANDROID_CHAT);

    const carlosMessages = filterParticipantMessages(result.messages, 'Carlos Silva');
    assert.equal(carlosMessages.length, 3);

    for (const msg of carlosMessages) {
      assert.equal(msg.sender, 'Carlos Silva');
      assert.notEqual(msg.sender, 'Elton');
      assert.ok(!msg.content.includes('Opa Carlos, tudo ótimo'));
      assert.ok(!msg.content.includes('Fechamos sim, ficou top'));
    }

    const eltonMessages = filterParticipantMessages(result.messages, 'Elton');
    assert.equal(eltonMessages.length, 2);
    for (const msg of eltonMessages) {
      assert.equal(msg.sender, 'Elton');
    }
  });

  it('extracts stylometry metrics: emojis, slang, word count and punctuation traits', () => {
    const messages = [
      'showww mano, valeu mesmo!! 🚀🔥',
      'tudo certo mano! 🔥',
      'blz então cara',
      'fechou bora',
    ];

    const stylometry = extractStylometry(messages);

    assert.equal(stylometry.totalAnalyzedMessages, 4);
    assert.ok(stylometry.averageWordsPerMessage > 0);
    assert.ok(stylometry.topEmojis.some((e) => e.emoji === '🔥'));
    assert.ok(stylometry.topEmojis.some((e) => e.emoji === '🚀'));
    assert.ok(stylometry.commonSlang.includes('mano'));
    assert.ok(stylometry.punctuation.exclamationRatio > 0);
  });
});
