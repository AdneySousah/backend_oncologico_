'use strict';

// Auditoria "para quem": cada log passa a carregar o paciente afetado
// (paciente_id), o que permite buscar por paciente na tela de Auditoria e
// responder "quem mexeu e para quem" sem depender do texto do log.
//
// Backfill dos logs antigos a partir da entidade/entity_id que já estavam
// gravados (mesma regra que o AuditService usa daqui pra frente):
//   Monitoramento           -> monitoramento_medicamentos.paciente_id
//   Pacientes / Termo* / NPS* -> entity_id é o próprio paciente
//   Entrevista/Avaliação    -> patient_evaluations.paciente_id
//   Chat                    -> conversations.paciente_id
// Logs sem paciente (usuários, perfis, operadoras, cadastros, sincronização
// em lote, fechamento de mês, login) ficam com paciente_id nulo.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('audit_logs', 'paciente_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'pacientes', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Paciente afetado pela ação (null quando a ação não é sobre um paciente)'
    });
    await queryInterface.addIndex('audit_logs', ['paciente_id'], { name: 'audit_logs_paciente_id_idx' });

    await queryInterface.sequelize.query(`
      UPDATE audit_logs a SET paciente_id = m.paciente_id
        FROM monitoramento_medicamentos m
       WHERE a.paciente_id IS NULL AND a.entity = 'Monitoramento' AND a.entity_id = m.id;
    `);
    await queryInterface.sequelize.query(`
      UPDATE audit_logs a SET paciente_id = p.id
        FROM pacientes p
       WHERE a.paciente_id IS NULL AND a.entity_id = p.id
         AND (a.entity IN ('Pacientes', 'Paciente', 'NPS') OR a.entity LIKE 'Termo%' OR a.entity LIKE 'NPS %')
         AND a.entity <> 'Versão do Termo';
    `);
    await queryInterface.sequelize.query(`
      UPDATE audit_logs a SET paciente_id = e.paciente_id
        FROM patient_evaluations e
       WHERE a.paciente_id IS NULL AND a.entity = 'Entrevista/Avaliação' AND a.entity_id = e.id;
    `);
    await queryInterface.sequelize.query(`
      UPDATE audit_logs a SET paciente_id = c.paciente_id
        FROM conversations c
       WHERE a.paciente_id IS NULL AND a.entity = 'Chat' AND a.entity_id = c.id;
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('audit_logs', 'audit_logs_paciente_id_idx');
    await queryInterface.removeColumn('audit_logs', 'paciente_id');
  }
};
