import Sequelize, { Model } from 'sequelize';

class NpsResponse extends Model {
    static init(sequelize) {
        super.init({
            nota: Sequelize.INTEGER,
            monitoramento_id: Sequelize.INTEGER, // <-- Nova coluna mapeada
        }, {
            sequelize,
            tableName: 'nps_responses',
        });
        return this;
    }

    static associate(models) {
        // Relacionamento com o paciente
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
        

        if (models.MonitoramentoMedicamento) {
            this.belongsTo(models.MonitoramentoMedicamento, { foreignKey: 'monitoramento_id', as: 'monitoramento' });
        }
    }
}

export default NpsResponse;