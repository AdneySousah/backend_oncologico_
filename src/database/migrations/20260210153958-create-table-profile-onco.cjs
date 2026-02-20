// migrations/20240101000001-create-oncology-professionals.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.createTable('oncology_professionals', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE', // Se deletar o user, deleta o perfil (ou use SET NULL)
        allowNull: false,
        unique: true, // Garante relação 1:1
      },
      // Ex: CRM, COREN, CRF
      registry_type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      // Ex: 123456-SP
      registry_number: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      // Ex: Oncologia Clínica, Cirurgia, Enfermagem Oncológica
      specialty: {
        type: Sequelize.STRING,
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
    return queryInterface.dropTable('oncology_professionals');
  },
};