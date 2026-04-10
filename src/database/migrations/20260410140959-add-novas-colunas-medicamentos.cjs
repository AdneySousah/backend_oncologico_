'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Usamos uma transaction para garantir que ou todas as colunas são criadas, ou nenhuma é
    return queryInterface.sequelize.transaction(t => {
      return Promise.all([
        queryInterface.addColumn('medicamentos', 'external_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
        }, { transaction: t }),
        
        queryInterface.addColumn('medicamentos', 'apresentacao', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t }),

        queryInterface.addColumn('medicamentos', 'via_administracao', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t }),

        queryInterface.addColumn('medicamentos', 'tipo_matmed', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t }),

        queryInterface.addColumn('medicamentos', 'tipo_medicamento', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction: t })
      ]);
    });
  },

  async down (queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(t => {
      return Promise.all([
        queryInterface.removeColumn('medicamentos', 'external_id', { transaction: t }),
        queryInterface.removeColumn('medicamentos', 'apresentacao', { transaction: t }),
        queryInterface.removeColumn('medicamentos', 'via_administracao', { transaction: t }),
        queryInterface.removeColumn('medicamentos', 'tipo_matmed', { transaction: t }),
        queryInterface.removeColumn('medicamentos', 'tipo_medicamento', { transaction: t })
      ]);
    });
  }
};