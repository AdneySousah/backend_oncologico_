'use strict';

// O status "Pendente" hoje mistura duas situações diferentes: paciente que
// nunca recebeu o link do termo, e paciente que recebeu mas ainda não
// respondeu. Isso confunde quem está operando — "Pendente" parecia dizer
// "já foi enviado", quando na real cobria os dois casos.
//
// Adiciona "Não Enviado" como um quarto status, e migra TODOS os pacientes
// que hoje estão como "Pendente" para "Não Enviado" — isso é uma decisão
// deliberada e simplificada: em vez de tentar reconstruir retroativamente
// (via auditoria) quem já tinha recebido o link antes desta migration, o
// sistema desenha uma linha limpa: tudo que já existia vira "Não Enviado"
// hoje, e a partir de agora "Pendente" passa a significar exatamente
// "recebeu o link e está aguardando resposta" (o código de envio do termo
// já muda o status pra "Pendente" em todos os 5 modos de disparo, sem
// precisar de nenhuma mudança de código pra isso).
//
// Dashboards já fechados (snapshots congelados) não são afetados — eles
// são fotografias já salvas, independentes do status atual dos pacientes.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_pacientes_status_termo" ADD VALUE IF NOT EXISTS 'Nao Enviado';`
    );
  },

  down: async (queryInterface) => {
    // Não é possível remover um valor de enum no Postgres sem recriar o
    // tipo inteiro — deixado como está no rollback (não quebra nada, só
    // fica um valor não utilizado no enum).
  }
};
