import cron from 'node-cron';
import Operadora from '../app/models/Operadora.js';
import DashboardSnapshot from '../app/models/DashboardSnapshot.js';
import { fecharMesInterno } from '../app/controllers/DashboardController.js';

const OFFSET_BRASILIA_MS = 3 * 60 * 60 * 1000;

// Mesmo prazo que vocês já usam hoje pra gerar a apresentação mensal
// (entre os dias 10 e 12). Dá espaço pra eventos de fim de mês que
// demoram alguns dias pra sincronizar/chegar no sistema.
const DIAS_PARA_FECHAR = 10;

function hojeBrasil() {
  const agoraUtc = new Date();
  const agoraBrasil = new Date(agoraUtc.getTime() - OFFSET_BRASILIA_MS);
  return {
    ano: agoraBrasil.getUTCFullYear(),
    mes: agoraBrasil.getUTCMonth() + 1,
    dia: agoraBrasil.getUTCDate(),
  };
}

function mesAnterior(ano, mes) {
  if (mes === 1) return { ano: ano - 1, mes: 12 };
  return { ano, mes: mes - 1 };
}

// Quantos meses pra trás o job verifica a cada execução. Cobre atraso
// acumulado (ex: servidor fora do ar por um tempo, ou meses antigos que
// nunca chegaram a ser fechados). Aumenta esse número se precisar cobrir
// um histórico maior; cada mês já fechado é só um SELECT barato (pulado).
const MESES_RETROATIVOS_VERIFICAR = 12;

// Fecha TODOS os meses pendentes (não só "o mês passado"), uma vez por
// operadora + uma vez consolidado (todas). Nunca sobrescreve um mês que já
// foi fechado — o fechamento automático só preenche o que ainda está em
// aberto. Pra recalcular um mês já fechado (ex: depois de corrigir um dado
// corrompido), use o endpoint manual POST /dashboard/fechar-mes, que
// sobrescreve de propósito.
async function fecharMesesPendentes() {
  const hoje = hojeBrasil();
  const operadoras = await Operadora.findAll({ attributes: ['id'], raw: true });
  const alvos = [null, ...operadoras.map(o => o.id)]; // null = visão consolidada (todas)

  let cursor = mesAnterior(hoje.ano, hoje.mes);
  const mesMaisRecenteAindaNoPrazo = hoje.dia < DIAS_PARA_FECHAR;

  for (let i = 0; i < MESES_RETROATIVOS_VERIFICAR; i++) {
    // Só o mês passado MAIS RECENTE pode ainda não ter completado o prazo
    // de espera (DIAS_PARA_FECHAR) — qualquer mês mais antigo que esse já
    // passou do prazo há muito, então essa checagem só se aplica na 1ª volta.
    if (i === 0 && mesMaisRecenteAindaNoPrazo) {
      cursor = mesAnterior(cursor.ano, cursor.mes);
      continue;
    }

    for (const operadoraId of alvos) {
      try {
        const jaExiste = await DashboardSnapshot.findOne({
          where: { ano: cursor.ano, mes: cursor.mes, operadora_id: operadoraId }
        });
        if (jaExiste) continue;

        await fecharMesInterno({ ano: cursor.ano, mes: cursor.mes, operadoraId, userId: null });
        console.log(`[DASHBOARD CLOSE] Mês ${cursor.mes}/${cursor.ano} fechado automaticamente (operadora: ${operadoraId || 'todas'}).`);
      } catch (error) {
        console.error(`[DASHBOARD CLOSE] Falhou ao fechar ${cursor.mes}/${cursor.ano} (operadora: ${operadoraId || 'todas'}):`, error.message);
      }
    }

    cursor = mesAnterior(cursor.ano, cursor.mes);
  }
}

export function iniciarJobFechamentoDashboard() {
  // Roda todo dia às 03:00 (horário de Brasília, independente do fuso do
  // servidor). Nos dias antes de DIAS_PARA_FECHAR, a checagem só roda e sai
  // sem fazer nada — é barato.
  cron.schedule('0 3 * * *', fecharMesesPendentes, { timezone: 'America/Sao_Paulo' });

  // Roda também uma vez já na subida do servidor, cobrindo o caso do
  // servidor ter ficado fora do ar justo no dia do fechamento.
  fecharMesesPendentes();
}
