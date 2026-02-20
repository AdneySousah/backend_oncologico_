module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('entrevista_profissional', 'infos_medicamentos_id', {
      type: Sequelize.INTEGER,
      references: { model: 'infos_medicamentos', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('entrevista_profissional', 'infos_medicamentos_id');
  }
};