import OpenAI, { APIError } from 'openai';
import { addDays, parseISO, format } from 'date-fns';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODELO = 'gpt-4o-mini'; // confira com o curl acima antes de subir pra produção

function limparJson(texto) {
  const semFences = texto.replace(/```json|```/g, '').trim();
  const match = semFences.match(/\{[\s\S]*\}/); // pega o primeiro bloco { ... }, ignora texto solto ao redor
  return match ? match[0] : semFences;
}

class AssistenteCalculoController {
  async calcular(req, res) {
    const { mensagem, historico } = req.body;
    if (!mensagem || !mensagem.trim()) {
      return res.status(400).json({ error: 'Envie uma pergunta.' });
    }
    try {
      const hoje = new Date();
      const hojeFormatado = format(hoje, 'dd/MM/yyyy');

      const systemPrompt = `Você é uma calculadora de datas para uma equipe de telemonitoramento de medicamentos. As enfermeiras enviam perguntas informais em português sobre quantidade de comprimidos, data de início do uso e posologia diária.

A data de hoje é ${hojeFormatado}.

Você DEVE responder APENAS com um JSON válido, sem markdown, sem \`\`\`, sem texto antes ou depois. Você NUNCA calcula a data final sozinha — só extrai os dados; o cálculo é feito por outro sistema.

Formatos possíveis de resposta:

1) Pergunta sobre quando o medicamento acaba/termina/dura até quando:
{"entendido": true, "tipo": "DATA_FIM_MEDICAMENTO", "data_inicio": "AAAA-MM-DD", "quantidade_total": <numero>, "posologia_diaria": <numero>}

2) Pergunta sobre somar ou subtrair dias de uma data:
{"entendido": true, "tipo": "SOMAR_DIAS", "data_base": "AAAA-MM-DD", "dias_a_somar": <numero inteiro, pode ser negativo>}

3) Faltou alguma informação, ou a pergunta não é sobre datas/medicamentos:
{"entendido": false, "pergunta_esclarecimento": "<pergunta curta e direta pedindo o que falta>"}

Regras:
- Sempre converta datas para AAAA-MM-DD, mesmo que venham como "22/07", "22-07-2026" ou "dia 22 de julho". Se faltar o ano, use o ano atual com base na data de hoje informada acima.
- "quantidade_total" e "posologia_diaria" são sempre números inteiros.
- Nunca invente um valor que não foi informado — peça esclarecimento (formato 3) se faltar algo.`;

      const historicoConvertido = Array.isArray(historico)
        ? historico.flatMap(h => ([
            { role: 'user', content: h.pergunta },
            { role: 'assistant', content: h.resposta }
          ]))
        : [];

      let respostaIA;
      try {
        respostaIA = await openai.chat.completions.create({
          model: MODELO,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            ...historicoConvertido,
            { role: 'user', content: mensagem }
          ]
        });
      } catch (erroOpenAI) {
        const statusOpenAI = erroOpenAI instanceof APIError ? erroOpenAI.status : null;
        console.error('[AssistenteCalculo] Falha ao chamar a OpenAI:', statusOpenAI, erroOpenAI.error || erroOpenAI.message);

        if (statusOpenAI === 404) {
          return res.json({
            resposta: 'O assistente de cálculo está temporariamente indisponível — o modelo de IA configurado foi descontinuado. Contate o administrador do sistema para atualizar a configuração.',
            data_resultante: null,
            motivo_tecnico: `Modelo "${MODELO}" não encontrado na OpenAI (404). Rode o curl em /v1/models e troque a constante MODELO em AssistenteCalculoController.js.`
          });
        }
        return res.json({
          resposta: 'O assistente de cálculo está temporariamente indisponível. Contate o administrador do sistema.',
          data_resultante: null,
          motivo_tecnico: `Erro na API da OpenAI${statusOpenAI ? ` (status ${statusOpenAI})` : ''}: ${erroOpenAI.message}`
        });
      }

      const textoBruto = respostaIA.choices?.[0]?.message?.content || '';

      let extraido;
      try {
        extraido = JSON.parse(limparJson(textoBruto));
      } catch (erroParse) {
        return res.json({
          resposta: 'Não consegui entender essa pergunta. Pode reformular com a quantidade, a data de início e quantos comprimidos por dia?',
          data_resultante: null
        });
      }

      if (!extraido.entendido) {
        return res.json({
          resposta: extraido.pergunta_esclarecimento || 'Pode dar mais detalhes?',
          data_resultante: null
        });
      }

      if (extraido.tipo === 'DATA_FIM_MEDICAMENTO') {
        const { data_inicio, quantidade_total, posologia_diaria } = extraido;
        if (!data_inicio || !quantidade_total || !posologia_diaria) {
          return res.json({
            resposta: 'Preciso da data de início, da quantidade total de comprimidos e de quantos comprimidos por dia pra calcular.',
            data_resultante: null
          });
        }
        const dataInicioObj = parseISO(data_inicio);
        const diasDuracao = Math.floor(Number(quantidade_total) / Number(posologia_diaria));
        const dataFimObj = addDays(dataInicioObj, diasDuracao);
        return res.json({
          resposta: `Começando em ${format(dataInicioObj, 'dd/MM/yyyy')}, com ${quantidade_total} comprimidos e ${posologia_diaria} por dia, o medicamento dura ${diasDuracao} dias e termina em ${format(dataFimObj, 'dd/MM/yyyy')}.`,
          data_resultante: format(dataFimObj, 'yyyy-MM-dd')
        });
      }

      if (extraido.tipo === 'SOMAR_DIAS') {
        const { data_base, dias_a_somar } = extraido;
        if (!data_base || dias_a_somar == null) {
          return res.json({
            resposta: 'Preciso da data base e de quantos dias somar (ou subtrair).',
            data_resultante: null
          });
        }
        const dataBaseObj = parseISO(data_base);
        const dataResultadoObj = addDays(dataBaseObj, Number(dias_a_somar));
        return res.json({
          resposta: `${format(dataBaseObj, 'dd/MM/yyyy')} ${dias_a_somar >= 0 ? '+' : ''}${dias_a_somar} dias = ${format(dataResultadoObj, 'dd/MM/yyyy')}.`,
          data_resultante: format(dataResultadoObj, 'yyyy-MM-dd')
        });
      }

      return res.json({ resposta: 'Não consegui entender esse tipo de cálculo ainda.', data_resultante: null });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao processar o cálculo.', details: error.message });
    }
  }
}

export default new AssistenteCalculoController();