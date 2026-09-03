'use strict';

// Duas tabelas órfãs do antigo conceito de "usuário profissional"
// (OncologyProfessional + Especialidade vinculada a ele), removido junto
// com o cadastro manual de usuário profissional. oncology_professionals já
// não tinha nenhum código (model/controller) desde a faxina anterior, mas a
// tabela nunca tinha sido apagada do banco — e é ela que segura a FK que
// impede apagar specialities. Confirmado antes de remover: nenhum model
// associa a nenhuma das duas, e nenhuma outra tabela referencia
// oncology_professionals.
module.exports = {
  up: async (queryInterface) => {
    // Precisa cair primeiro — é quem tem a FK apontando pra specialities.
    await queryInterface.dropTable('oncology_professionals');
    await queryInterface.dropTable('specialities');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('specialities', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
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

    await queryInterface.createTable('oncology_professionals', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      registry_type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      registry_number: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      especiality_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'specialities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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
  }
};
