module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('medicos_prestadores', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      medico_id: {
        type: Sequelize.INTEGER,
        references: { model: 'medicos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        allowNull: false,
      },
      prestador_medico_id: {
        type: Sequelize.INTEGER,
        references: { model: 'prestador_medico', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
    await queryInterface.dropTable('medicos_prestadores');
  }
};