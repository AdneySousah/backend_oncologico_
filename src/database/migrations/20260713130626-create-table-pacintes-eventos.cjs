// Migration: create-eventos-pacientes
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('eventos_pacientes', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      external_id: { type: Sequelize.INTEGER, allowNull: false, unique: true }, // O ID do evento lá na API externa
      paciente_id: { type: Sequelize.INTEGER, references: { model: 'pacientes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE', allowNull: false },
      medicamento_id: { type: Sequelize.INTEGER, references: { model: 'medicamentos', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL', allowNull: true },
      data_entrega_prevista: { type: Sequelize.DATEONLY, allowNull: true },
      data_administracao_prevista: { type: Sequelize.DATEONLY, allowNull: true },
      qtd_caixas: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      preco: { type: Sequelize.NUMERIC, allowNull: true },
      recebido: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('eventos_pacientes');
  }
};