'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.createTable('monitoramento_edicoes_em_andamento', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      // ⚠️ Confirme se a tabela do model Pacientes realmente se chama
      // 'pacientes' antes de rodar. Se for outro nome, ajuste aqui.
      paciente_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true, // só existe UMA reserva ativa por paciente por vez
        references: { model: 'pacientes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      iniciado_em: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      expira_em: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },
  down: async (queryInterface) => {
    return queryInterface.dropTable('monitoramento_edicoes_em_andamento');
  },
};