'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      await queryInterface.addColumn(
        'monitoramento_medicamentos',
        'mudou_posologia',
        {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
          allowNull: true,
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'monitoramento_medicamentos',
        'nova_posologia',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'monitoramento_medicamentos',
        'data_mudanca_posologia',
        {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      await queryInterface.removeColumn('monitoramento_medicamentos', 'mudou_posologia', { transaction });
      await queryInterface.removeColumn('monitoramento_medicamentos', 'nova_posologia', { transaction });
      await queryInterface.removeColumn('monitoramento_medicamentos', 'data_mudanca_posologia', { transaction });
      
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};