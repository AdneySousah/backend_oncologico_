import Sequelize, { Model } from 'sequelize';

class NpsResponse extends Model {
    static init(sequelize) {
        super.init({
            nota: Sequelize.INTEGER,
        }, {
            sequelize,
            tableName: 'nps_responses',
        });
        return this;
    }

    static associate(models) {
        // Relacionamento reverso com o paciente
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    }
}

export default NpsResponse;