'use strict';

// Rastreio de PROCESSAMENTO dos eventos de compra: até aqui o único vínculo
// evento ↔ telemonitoramento era monitoramento_medicamentos.evento_externo_id,
// então não dava pra saber SE um evento foi processado, QUANDO, POR QUEM, nem
// distinguir "virou ciclo" de "medicamento usado mas pulado" (operador aplicou
// uma compra mais recente). Estas colunas registram isso diretamente no evento.
//
// Backfill: todo evento que já aparece em algum ciclo recebe processado = true
// (tipo CICLO), com processado_em = created_at do PRIMEIRO ciclo que o usou —
// aproximação, porque a hora real do processamento nunca foi gravada.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('eventos_pacientes', 'processado', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true quando o telemonitoramento já consumiu este evento (virou ciclo ou foi marcado como usado)'
    });
    await queryInterface.addColumn('eventos_pacientes', 'processado_em', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Momento em que o evento foi processado'
    });
    await queryInterface.addColumn('eventos_pacientes', 'processado_por_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Usuário que processou o evento (null no backfill)'
    });
    await queryInterface.addColumn('eventos_pacientes', 'monitoramento_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'monitoramento_medicamentos', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Ciclo de monitoramento criado a partir deste evento (null quando consumido sem ciclo próprio)'
    });
    await queryInterface.addColumn('eventos_pacientes', 'tipo_processamento', {
      type: Sequelize.ENUM('CICLO', 'CONSUMIDO_SEM_CICLO'),
      allowNull: true,
      comment: 'CICLO = gerou um ciclo de monitoramento; CONSUMIDO_SEM_CICLO = medicamento usado, mas pulado ao aplicar uma compra mais recente'
    });
    await queryInterface.addColumn('eventos_pacientes', 'processamento_observacao', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.sequelize.query(`
      UPDATE eventos_pacientes e
         SET processado = true,
             tipo_processamento = 'CICLO',
             processado_em = m.primeiro_em,
             monitoramento_id = m.primeiro_id,
             processamento_observacao = 'Preenchido retroativamente pela migration add-processamento-to-eventos-pacientes: data = criação do primeiro ciclo que usou o evento.'
        FROM (
          SELECT DISTINCT ON (evento_externo_id) evento_externo_id, id AS primeiro_id, created_at AS primeiro_em
            FROM monitoramento_medicamentos
           WHERE evento_externo_id IS NOT NULL
           ORDER BY evento_externo_id, created_at ASC, id ASC
        ) m
       WHERE m.evento_externo_id = e.external_id
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('eventos_pacientes', 'processamento_observacao');
    await queryInterface.removeColumn('eventos_pacientes', 'tipo_processamento');
    await queryInterface.removeColumn('eventos_pacientes', 'monitoramento_id');
    await queryInterface.removeColumn('eventos_pacientes', 'processado_por_id');
    await queryInterface.removeColumn('eventos_pacientes', 'processado_em');
    await queryInterface.removeColumn('eventos_pacientes', 'processado');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_eventos_pacientes_tipo_processamento"');
  }
};
