// migration: add-grupo-medicamentos-id.js
export default {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('monitoramento_medicamentos', 'grupo_medicamentos_id', {
    type: Sequelize.STRING,
    allowNull: true
  }),
  down: (queryInterface) => queryInterface.removeColumn('monitoramento_medicamentos', 'grupo_medicamentos_id')
};