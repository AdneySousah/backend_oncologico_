'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('dashboard_snapshots', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      ano: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      mes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      // null = snapshot consolidado (todas as operadoras)
      operadora_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'operadoras', key: 'id' },
      },
      // Guarda o payload inteiro que o dashboard monta hoje (termos, adesaoScore,
      // pacientesMonitorados, etc.) — se um gráfico novo for adicionado no futuro,
      // ele entra automaticamente no snapshot sem precisar de migration nova.
      dados: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      fechado_por: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      fechado_em: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // Postgres trata NULL como distinto de NULL em constraints UNIQUE normais,
    // então uma constraint única simples em (ano, mes, operadora_id) NÃO
    // impediria duplicatas quando operadora_id é NULL (visão consolidada).
    // Por isso usamos dois índices únicos parciais:
    await queryInterface.addIndex('dashboard_snapshots', ['ano', 'mes', 'operadora_id'], {
      unique: true,
      name: 'uniq_dashboard_snapshot_com_operadora',
      where: { operadora_id: { [Sequelize.Op.ne]: null } },
    });

    await queryInterface.addIndex('dashboard_snapshots', ['ano', 'mes'], {
      unique: true,
      name: 'uniq_dashboard_snapshot_sem_operadora',
      where: { operadora_id: null },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('dashboard_snapshots');
  },
};
