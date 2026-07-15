import Sequelize, { Model } from 'sequelize';

class EventosPaciente extends Model {
    static init(sequelize) {
        super.init({
            external_id: Sequelize.INTEGER,
            data_entrega_prevista: Sequelize.DATEONLY,
            data_administracao_prevista: Sequelize.DATEONLY,
            qtd_caixas: Sequelize.INTEGER,
            preco: Sequelize.NUMERIC,
            recebido: Sequelize.BOOLEAN,
            data_entrega_real: Sequelize.DATEONLY
        }, {
            sequelize,
            tableName: 'eventos_pacientes',
        });
        return this;
    }

    static associate(models) {
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
        this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento' });
    }
}

export default EventosPaciente;