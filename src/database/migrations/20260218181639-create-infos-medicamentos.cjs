module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('infos_medicamentos', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      possui_medicamento: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      medicamento_id: {
        type: Sequelize.INTEGER,
        references: { model: 'medicamentos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('infos_medicamentos');
  }
};