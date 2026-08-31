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

    const { mensagem, historico, data_referencia } = req.body;
    if (!mensagem || !mensagem.trim()) {
      return res.status(400).json({ error: 'Envie uma pergunta.' });
    }
    try {
      const dataReferenciaValida = data_referencia && !isNaN(parseISO(data_referencia).getTime());
      const dataReferenciaObj = dataReferenciaValida ? parseISO(data_referencia) : new Date();
      const hojeFormatado = format(dataReferenciaObj, 'dd/MM/yyyy');

      // MUDE PRA ESSE
      const systemPrompt = `Você é uma calculadora de datas para uma equipe de telemonitoramento de medicamentos. As enfermeiras enviam mensagens informais em português contendo alguma combinação de: quantidade de comprimidos (total da caixa e/ou quanto ainda resta), data de início do uso e posologia diária. NEM toda mensagem vai ter uma data de início — na maioria das vezes é justamente isso que está sendo perguntado (formato 2 abaixo), então a ausência de uma data não significa que falta informação.

A data de referência deste cálculo é ${hojeFormatado} — é o dia em que o tele foi realizado, não necessariamente o dia de hoje no relógio. Trate essa data como "hoje" pra tudo, inclusive pra completar anos que faltarem em datas mencionadas.

Você DEVE responder APENAS com um JSON válido, sem markdown, sem \`\`\`, sem texto antes ou depois. Você NUNCA faz nenhuma conta de dias sozinha — nem soma, nem subtração — só extrai os números e datas mencionados; todo o cálculo é feito por outro sistema.

Formatos possíveis de resposta:

1) Pergunta sobre quando o medicamento acaba/termina/dura até quando, a partir de uma data de início já conhecida:
{"entendido": true, "tipo": "DATA_FIM_MEDICAMENTO", "data_inicio": "AAAA-MM-DD", "quantidade_total": <numero>, "posologia_diaria": <numero>}

2) Pergunta sobre quando o paciente começou a tomar, a partir de quantos comprimidos ainda restam e do tamanho da caixa (ex: "tem 61 comprimidos, caixa de 90, toma 1 por dia, quando começou?"):
{"entendido": true, "tipo": "DATA_INICIO_MEDICAMENTO", "quantidade_restante": <numero>, "quantidade_total": <numero>, "posologia_diaria": <numero>}

3) Pergunta sobre somar ou subtrair uma quantidade de dias JÁ DITA EXPLICITAMENTE pela enfermeira a partir de uma data (não use este formato se a quantidade de dias precisar ser calculada a partir de comprimidos restantes — nesse caso use o formato 2):
{"entendido": true, "tipo": "SOMAR_DIAS", "data_base": "AAAA-MM-DD", "dias_a_somar": <numero inteiro, pode ser negativo>}

4) Faltou alguma informação, ou a pergunta não é sobre datas/medicamentos:
{"entendido": false, "pergunta_esclarecimento": "<pergunta curta e direta pedindo o que falta>"}

Regras:
- Sempre converta datas para AAAA-MM-DD, mesmo que venham como "22/07", "22-07-2026" ou "dia 22 de julho". Se faltar o ano, use o ano atual com base na data de referência informada acima.
- "quantidade_total", "quantidade_restante" e "posologia_diaria" são sempre números inteiros.
// MUDE PRA ESSE
- Se a pergunta mencionar comprimidos restantes e tamanho da caixa (em vez de uma quantidade de dias pronta), é sempre o formato 2 — nunca subtraia os valores você mesma pra virar um "dias_a_somar".
- Se a mensagem trouxer quantidade restante e quantidade total da caixa, mas NÃO mencionar nenhuma data de início, classifique SEMPRE como formato 2 — mesmo que não haja uma pergunta explícita tipo "quando começou?". Nesse caso NUNCA peça a data de início: essa data é justamente o que você está calculando.
- Nunca invente um valor que não foi informado — peça esclarecimento (formato 4) se faltar algo.

Exemplo (mensagem só com os dados, sem pergunta explícita):
"tem 61 comprimidos caixa cmo 90 toma um por dia" → {"entendido": true, "tipo": "DATA_INICIO_MEDICAMENTO", "quantidade_restante": 61, "quantidade_total": 90, "posologia_diaria": 1}`;

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

      if (extraido.tipo === 'DATA_INICIO_MEDICAMENTO') {
        const { quantidade_restante, quantidade_total, posologia_diaria } = extraido;
        if (quantidade_restante == null || !quantidade_total || !posologia_diaria) {
          return res.json({
            resposta: 'Preciso de quantos comprimidos restam, do total da caixa e de quantos comprimidos por dia pra calcular quando ela começou.',
            data_resultante: null
          });
        }
        const consumido = Number(quantidade_total) - Number(quantidade_restante);
        if (consumido < 0) {
          return res.json({
            resposta: `A quantidade que resta (${quantidade_restante}) não pode ser maior que o total da caixa (${quantidade_total}). Confere esses números?`,
            data_resultante: null
          });
        }
        const diasConsumidos = Math.floor(consumido / Number(posologia_diaria));
        const dataInicioCalculada = addDays(dataReferenciaObj, -diasConsumidos);
        return res.json({
          resposta: `Com ${quantidade_restante} restando de uma caixa de ${quantidade_total}, tomando ${posologia_diaria} por dia, ela consumiu ${consumido} comprimidos em ${diasConsumidos} dias. Contando a partir de ${format(dataReferenciaObj, 'dd/MM/yyyy')} (data do tele), ela começou a tomar em ${format(dataInicioCalculada, 'dd/MM/yyyy')}.`,
          data_resultante: format(dataInicioCalculada, 'yyyy-MM-dd')
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